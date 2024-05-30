// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import { Create2 } from "@openzeppelin/contracts/utils/Create2.sol";
// import { EnumerableMap } from "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";

import { IEmptySetReserve } from "@equilibria/emptyset-batcher/interfaces/IEmptySetReserve.sol";
import { Instance } from "@equilibria/root/attribute/Instance.sol";
import { Token6 } from "@equilibria/root/token/types/Token6.sol";
import { Token18 } from "@equilibria/root/token/types/Token18.sol";
import { UFixed6 } from "@equilibria/root/number/types/UFixed6.sol";

import { IAccount, IMarket } from "./interfaces/IAccount.sol";
import { IController } from "./interfaces/IController.sol";
import { IVerifier } from "./interfaces/IVerifier.sol";
import { Account } from "./Account.sol";
import { DeployAccount, DeployAccountLib } from "./types/DeployAccount.sol";
import { MarketTransfer, MarketTransferLib } from "./types/MarketTransfer.sol";
import {
    RebalanceConfig,
    RebalanceConfigLib,
    RebalanceConfigChange,
    RebalanceConfigChangeLib
} from "./types/RebalanceConfig.sol";
import { SignerUpdate, SignerUpdateLib } from "./types/SignerUpdate.sol";
import { Withdrawal, WithdrawalLib } from "./types/Withdrawal.sol";

/// @title Controller
/// @notice Facilitates unpermissioned actions between collateral accounts and markets
contract Controller is Instance, IController {
    // using EnumerableMap for EnumerableMap.AddressToUintMap;

    // used for deterministic address creation through create2
    bytes32 constant SALT = keccak256("Perennial V2 Collateral Accounts");

    /// @dev USDC stablecoin address
    Token6 public USDC; // solhint-disable-line var-name-mixedcase

    /// @dev DSU address
    Token18 public DSU; // solhint-disable-line var-name-mixedcase

    /// @dev Contract used to validate messages were signed by the sender
    IVerifier public verifier;

    /// @dev DSU Reserve address
    IEmptySetReserve public reserve;

    /// @dev Mapping of allowed signers for each account owner
    /// owner => delegate => enabled flag
    mapping(address => mapping(address => bool)) public signers;

    // TODO: Messy!  Refactor lines 55-71 into a Rebalance storage struct
    // and RebalanceLib library which abstracts away the complexity of managing configuration,
    // and reduces contract size by keeping management logic in an external lib.

    /// @dev Mapping of rebalance configuration
    /// owner => group => market => config
    mapping(address => mapping(uint256 => mapping(address => RebalanceConfig))) public rebalanceConfig;

    /// @dev Serial identifier for rebalancing groups
    uint256 public lastGroupId;

    /// @dev Prevents markets from being added to multiple groups
    /// owner => market => group
    mapping(address => mapping(address => uint256)) public marketToGroup;

    /// @dev Prevents users from making up their own group numbers
    /// group => owner
    mapping(uint256 => address) public groupToOwner;

    /// @dev Allows iteration through markets in a group
    mapping(uint256 => address[]) public groupToMarkets;

    /// @notice Configures the EIP-712 message verifier used by this controller
    /// @param verifier_ Contract used to validate messages were signed by the sender
    /// @param usdc_ USDC token address
    /// @param dsu_ DSU token address
    /// @param reserve_ DSU Reserve address, used by Account
    function initialize(
        IVerifier verifier_,
        Token6 usdc_,
        Token18 dsu_,
        IEmptySetReserve reserve_
    ) external initializer(1) {
        __Instance__initialize();
        verifier = verifier_;
        USDC = usdc_;
        DSU = dsu_;
        reserve = reserve_;
    }

    /// @inheritdoc IController
    function getAccountAddress(address user) public view returns (address) {
        // generate bytecode for an account created for the specified owner
        bytes memory bytecode = abi.encodePacked(
            type(Account).creationCode,
            abi.encode(user),
            abi.encode(address(this)),
            abi.encode(USDC),
            abi.encode(DSU),
            abi.encode(reserve));
        // calculate the hash for that bytecode and compute the address
        return Create2.computeAddress(SALT, keccak256(bytecode));
    }

    /// @inheritdoc IController
    function deployAccount() public returns (IAccount) {
        return _createAccount(msg.sender);
    }

    /// @inheritdoc IController
    function deployAccountWithSignature(
        DeployAccount calldata deployAccount_,
        bytes calldata signature
    ) virtual external {
        _deployAccountWithSignature(deployAccount_, signature);
    }

    function _deployAccountWithSignature(
        DeployAccount calldata deployAccount_,
        bytes calldata signature
    ) internal returns (IAccount account) {
        address owner = deployAccount_.action.common.account;
        address signer = verifier.verifyDeployAccount(deployAccount_, signature);
        _ensureValidSigner(owner, signer);

        // create the account
        account = _createAccount(owner);
    }

    function _createAccount(address owner) internal returns (IAccount account) {
        account = new Account{salt: SALT}(owner, address(this), USDC, DSU, reserve);
        emit AccountDeployed(owner, account);
    }

    /// @inheritdoc IController
    function marketTransferWithSignature(MarketTransfer calldata marketTransfer, bytes calldata signature) virtual external {
        IAccount account = IAccount(getAccountAddress(marketTransfer.action.common.account));
        _marketTransferWithSignature(account, marketTransfer, signature);
    }

    function _marketTransferWithSignature(IAccount account, MarketTransfer calldata marketTransfer, bytes calldata signature) internal {
        // ensure the message was signed by the owner or a delegated signer
        address signer = verifier.verifyMarketTransfer(marketTransfer, signature);
        _ensureValidSigner(marketTransfer.action.common.account, signer);

        // only Markets with DSU collateral are supported
        IMarket market = IMarket(marketTransfer.market);
        if (!market.token().eq(DSU)) revert ControllerUnsupportedMarket(address(market));

        account.marketTransfer(market, marketTransfer.amount);
    }

    function changeRebalanceConfigWithSignature(
        RebalanceConfigChange calldata configChange,
        bytes calldata signature
    ) virtual external {
        // ensure the message was signed by the owner or a delegated signer
        address signer = verifier.verifyRebalanceConfigChange(configChange, signature);
        _ensureValidSigner(configChange.action.common.account, signer);

        // sum of the target allocations of all markets in the group
        UFixed6 totalAllocation;
        // put this on the stack for readability
        address owner = configChange.action.common.account;

        // create a new group
        if (configChange.group == 0) {
            lastGroupId++;
            for (uint256 i; i < configChange.markets.length; ++i)
            {
                // ensure market isn't already pointing to a group
                uint256 currentGroup = marketToGroup[owner][configChange.markets[i]];
                if (currentGroup != 0)
                    revert ControllerMarketAlreadyInGroup(configChange.markets[i], currentGroup);

                // update state
                groupToOwner[lastGroupId] = owner;
                marketToGroup[owner][configChange.markets[i]] = lastGroupId;
                rebalanceConfig[owner][lastGroupId][configChange.markets[i]] = configChange.configs[i];
                groupToMarkets[lastGroupId].push(configChange.markets[i]);

                // Ensure target allocation across all markets totals 100%.
                totalAllocation = totalAllocation.add(configChange.configs[i].target);

                emit RebalanceMarketConfigured(owner, lastGroupId, configChange.markets[i], configChange.configs[i]);
            }
            emit RebalanceGroupConfigured(owner, lastGroupId);

        // update an existing group
        } else {
            // ensure this group was created for the owner, preventing user from assigning their own number
            if (groupToOwner[configChange.group] != owner)
                revert ControllerInvalidRebalanceGroup();

            // delete the existing group
            for (uint256 i; i < groupToMarkets[configChange.group].length; ++i) {
                address market = groupToMarkets[configChange.group][i];
                delete rebalanceConfig[owner][configChange.group][market];
                delete marketToGroup[owner][market];
            }
            delete groupToMarkets[configChange.group];

            for (uint256 i; i < configChange.markets.length; ++i) {
                // ensure market is not pointing to a different group
                uint256 currentGroup = marketToGroup[owner][configChange.markets[i]];
                if (/*currentGroup != configChange.group &&*/ currentGroup != 0)
                    revert ControllerMarketAlreadyInGroup(configChange.markets[i], currentGroup);

                // rewrite over all the old configuration
                marketToGroup[owner][configChange.markets[i]] = configChange.group;
                rebalanceConfig[owner][configChange.group][configChange.markets[i]] = configChange.configs[i];

                // ensure target allocation across all markets totals 100%
                // read from storage to trap duplicate markets in the message
                totalAllocation = totalAllocation.add(
                    rebalanceConfig[owner][configChange.group][configChange.markets[i]].target
                );

                emit RebalanceMarketConfigured(owner, configChange.group, configChange.markets[i], configChange.configs[i]);
            }

            emit RebalanceGroupConfigured(owner, configChange.group);
        }

        if (!totalAllocation.eq(RebalanceConfigLib.MAX_PERCENT))
            revert ControllerInvalidRebalanceTargets();
    }

    /// @inheritdoc IController
    function updateSigner(address signer, bool newEnabled) public {
        signers[msg.sender][signer] = newEnabled;
        emit SignerUpdated(msg.sender, signer, newEnabled);
    }

    /// @inheritdoc IController
    function updateSignerWithSignature(
        SignerUpdate calldata signerUpdate,
        bytes calldata signature
    ) virtual external {
        _updateSignerWithSignature(signerUpdate, signature);
    }

    function _updateSignerWithSignature(SignerUpdate calldata signerUpdate,  bytes calldata signature) internal {
        // ensure the message was signed only by the owner, not an existing delegate
        address messageSigner = verifier.verifySignerUpdate(signerUpdate, signature);
        address owner = signerUpdate.action.common.account;
        if (messageSigner != owner) revert ControllerInvalidSigner();

        signers[owner][signerUpdate.signer] = signerUpdate.approved;
        emit SignerUpdated(owner, signerUpdate.signer, signerUpdate.approved);
    }

    /// @inheritdoc IController
    function withdrawWithSignature(Withdrawal calldata withdrawal, bytes calldata signature) virtual external {
        IAccount account = IAccount(getAccountAddress(withdrawal.action.common.account));
        _withdrawWithSignature(account, withdrawal, signature);
    }

    function _withdrawWithSignature(IAccount account, Withdrawal calldata withdrawal, bytes calldata signature) internal {
        // ensure the message was signed by the owner or a delegated signer
        address signer = verifier.verifyWithdrawal(withdrawal, signature);
        _ensureValidSigner(withdrawal.action.common.account, signer);

        // call the account's implementation to push to owner
        account.withdraw(withdrawal.amount, withdrawal.unwrap);
    }

    /// @dev calculates the account address and reverts if user is not authorized to sign transactions for the owner
    function _ensureValidSigner(address owner, address signer) private view {
        if (signer != owner && !signers[owner][signer]) revert ControllerInvalidSigner();
    }
}
