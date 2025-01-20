// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import { Create2 } from "@openzeppelin/contracts/utils/Create2.sol";

import { Factory } from "@equilibria/root/attribute/Factory.sol";
import { Token6 } from "@equilibria/root/token/types/Token6.sol";
import { Token18 } from "@equilibria/root/token/types/Token18.sol";
import { Fixed6, Fixed6Lib } from "@equilibria/root/number/types/Fixed6.sol";
import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { UFixed18, UFixed18Lib } from "@equilibria/root/number/types/UFixed18.sol";
import { IMarketFactory } from "@perennial/v2-core/contracts/interfaces/IMarketFactory.sol";

import { IAccount, IMarket } from "./interfaces/IAccount.sol";
import { IAccountVerifier, IController } from "./interfaces/IController.sol";
import { RebalanceLib } from "./libs/RebalanceLib.sol";
import { Account } from "./Account.sol";
import { DeployAccount, DeployAccountLib } from "./types/DeployAccount.sol";
import { MarketTransfer, MarketTransferLib } from "./types/MarketTransfer.sol";
import { RebalanceConfig, RebalanceConfigLib } from "./types/RebalanceConfig.sol";
import { RebalanceConfigChange, RebalanceConfigChangeLib } from "./types/RebalanceConfigChange.sol";
import { Withdrawal, WithdrawalLib } from "./types/Withdrawal.sol";

/// @title Controller
/// @notice Facilitates unpermissioned actions between collateral accounts and markets,
/// without keeper compensation.  No message relaying facilities are provided.
contract Controller is Factory, IController {
    // used for deterministic address creation through create2
    bytes32 public constant SALT = keccak256("Perennial V2 Collateral Accounts");

    uint256 public constant MAX_GROUPS_PER_OWNER = 8;
    uint256 public constant MAX_MARKETS_PER_GROUP = 4;

    /// @dev USDC stablecoin address
    Token6 public immutable USDC; // solhint-disable-line var-name-mixedcase

    /// @dev DSU address
    Token18 public immutable DSU; // solhint-disable-line var-name-mixedcase

    /// @inheritdoc IController
    IMarketFactory public immutable marketFactory;

    /// @inheritdoc IController
    IAccountVerifier public verifier;

    /// @dev Mapping of rebalance configuration
    /// owner => group => market => config
    mapping(address => mapping(uint256 => mapping(address => RebalanceConfig))) private _rebalanceConfigs;

    /// @dev Prevents markets from being added to multiple rebalance groups
    /// owner => market => group
    mapping(address => mapping(address => uint256)) public marketToGroup;

    /// @dev Allows iteration through markets in a rebalance group
    /// owner => group => markets
    mapping(address => mapping(uint256 => IMarket[])) public groupToMarkets;

    /// @dev Limits relayer/keeper compensation for rebalancing a group, in DSU
    mapping(address => mapping(uint256 => UFixed6)) public groupToMaxRebalanceFee;

    /// @dev Creates instance of Controller
    /// @param implementation_ Collateral account contract initialized with stablecoin addresses
    constructor(address implementation_, IMarketFactory marketFactory_) Factory(implementation_) {
        USDC = Account(implementation_).USDC();
        DSU = Account(implementation_).DSU();
        marketFactory = marketFactory_;
    }

    /// @inheritdoc IController
    function initialize(
        IAccountVerifier verifier_
    ) external initializer(1) {
        __Factory__initialize();
        verifier = verifier_;
    }

    /// @inheritdoc IController
    function getAccountAddress(address owner) public view returns (address) {
        // calculate the hash for an uninitialized account for the owner
        return _computeCreate2Address(abi.encodeCall(Account.initialize, (owner)), SALT);
    }

    /// @inheritdoc IController
    function changeRebalanceConfigWithSignature(
        RebalanceConfigChange calldata configChange,
        bytes calldata signature
    ) virtual external {
        _changeRebalanceConfigWithSignature(configChange, signature);
    }

    /// @inheritdoc IController
    function checkGroup(address owner, uint256 group) public view returns (
        Fixed6 groupCollateral,
        bool canRebalance,
        Fixed6[] memory imbalances
    ) {
        // query owner's collateral in each market and calculate sum
        Fixed6[] memory actualCollateral;
        (actualCollateral, groupCollateral) = _queryMarketCollateral(owner, group);
        imbalances = new Fixed6[](actualCollateral.length);

        // determine if anything is outside the rebalance threshold
        for (uint256 i; i < actualCollateral.length; i++) {
            IMarket market = groupToMarkets[owner][group][i];
            RebalanceConfig memory marketRebalanceConfig = _rebalanceConfigs[owner][group][address(market)];
            (bool canMarketRebalance, Fixed6 imbalance) =
                RebalanceLib.checkMarket(
                    marketRebalanceConfig,
                    groupToMaxRebalanceFee[owner][group],
                    groupCollateral,
                    actualCollateral[i]
                );
            imbalances[i] = imbalance;
            canRebalance = canRebalance || canMarketRebalance;
        }

        // if group does not exist or was deleted, arrays will be empty and function will return (0, false, 0)
    }

    /// @inheritdoc IController
    function deployAccount() public returns (IAccount) {
        return _createAccount(msg.sender);
    }

    /// @inheritdoc IController
    function deployAccountWithSignature(
        DeployAccount calldata deployAccountAction,
        bytes calldata signature
    ) virtual external {
        _deployAccountWithSignature(deployAccountAction, signature);
    }

    /// @inheritdoc IController
    function marketTransferWithSignature(
        MarketTransfer calldata marketTransfer,
        bytes calldata signature
    ) virtual external {
        IAccount account = IAccount(getAccountAddress(marketTransfer.action.common.account));
        _marketTransferWithSignature(account, marketTransfer, signature);
    }

    /// @inheritdoc IController
    function rebalanceConfigs(
        address owner,
        uint256 group,
        address market
    ) external view returns (RebalanceConfig memory) {
        return _rebalanceConfigs[owner][group][market];
    }

    /// @inheritdoc IController
    function rebalanceGroupMarkets(
        address owner,
        uint256 group
    ) external view returns (IMarket[] memory markets) {
        markets = groupToMarkets[owner][group];
    }

    /// @inheritdoc IController
    function withdrawWithSignature(Withdrawal calldata withdrawal, bytes calldata signature) virtual external {
        IAccount account = IAccount(getAccountAddress(withdrawal.action.common.account));
        _withdrawWithSignature(account, withdrawal, signature);
    }

    /// @inheritdoc IController
    function rebalanceGroup(address owner, uint256 group) virtual external {
        _rebalanceGroup(owner, group);
    }

    /// @inheritdoc IController
    function chargeFee(address owner, UFixed6 amount) virtual external onlyOperator(owner, msg.sender) {
        address account = getAccountAddress(owner);
        UFixed18 transferAmount = UFixed18Lib.from(amount);

        // if the account has insufficient DSU to pay the fee, wrap
        IAccount(account).wrapIfNecessary(transferAmount, false);
        // transfer DSU from account to the caller
        DSU.pullTo(account, msg.sender, transferAmount);
    }

    function _changeRebalanceConfigWithSignature(RebalanceConfigChange calldata configChange, bytes calldata signature) internal {
        // ensure the message was signed by the owner or a delegated signer
        verifier.verifyRebalanceConfigChange(configChange, signature);
        // sum of the target allocations of all markets in the group
        _updateRebalanceGroup(configChange, configChange.action.common.account);
    }

    function _createAccount(address owner) internal returns (IAccount account) {
        account = Account(address(_create2(abi.encodeCall(Account.initialize, (owner)), SALT)));
        emit AccountDeployed(owner, account);
    }

    function _deployAccountWithSignature(
        DeployAccount calldata deployAccount_,
        bytes calldata signature
    ) internal returns (IAccount account) {
        address owner = deployAccount_.action.common.account;
        verifier.verifyDeployAccount(deployAccount_, signature);

        // create the account
        account = _createAccount(owner);
    }

    function _marketTransferWithSignature(
        IAccount account,
        MarketTransfer calldata marketTransfer,
        bytes calldata signature
    ) internal {
        // ensure the message was signed by the owner or a delegated signer
        verifier.verifyMarketTransfer(marketTransfer, signature);

        // only Markets with DSU collateral are supported
        IMarket market = IMarket(marketTransfer.market);
        if (!market.token().eq(DSU)) revert ControllerUnsupportedMarketError(market);

        account.marketTransfer(market, marketTransfer.amount);
    }

    function _withdrawWithSignature(
        IAccount account,
        Withdrawal calldata withdrawal,
        bytes calldata signature
    ) internal {
        // ensure the message was signed by the owner or a delegated signer
        verifier.verifyWithdrawal(withdrawal, signature);

        // call the account's implementation to push to owner
        account.withdraw(withdrawal.amount, withdrawal.unwrap);
    }

    function _rebalanceGroup(address owner, uint256 group) internal {
        // settles each markets, such that locals are up-to-date
        _settleMarkets(owner, group);

        // determine imbalances
        (, bool canRebalance, Fixed6[] memory imbalances) = checkGroup(owner, group);
        if (!canRebalance) revert ControllerGroupBalancedError();

        IAccount account = IAccount(getAccountAddress(owner));
        // pull collateral from markets with surplus collateral
        for (uint256 i; i < imbalances.length; i++) {
            IMarket market = groupToMarkets[owner][group][i];
            if (Fixed6.unwrap(imbalances[i]) < 0) account.marketTransfer(market, imbalances[i]);
        }

        // push collateral to markets with insufficient collateral
        for (uint256 i; i < imbalances.length; i++) {
            IMarket market = groupToMarkets[owner][group][i];
            if (Fixed6.unwrap(imbalances[i]) > 0) account.marketTransfer(market, imbalances[i]);
        }

        emit GroupRebalanced(owner, group);
    }

    /// @dev checks current collateral for each market in a group and aggregates collateral for the group
    function _queryMarketCollateral(address owner, uint256 group) private view returns (
        Fixed6[] memory actualCollateral,
        Fixed6 groupCollateral
    ) {
        actualCollateral = new Fixed6[](groupToMarkets[owner][group].length);
        for (uint256 i; i < actualCollateral.length; i++) {
            Fixed6 collateral = groupToMarkets[owner][group][i].locals(owner).collateral;
            actualCollateral[i] = collateral;
            groupCollateral = groupCollateral.add(collateral);
        }
    }

    /// @dev settles each market in a rebalancing group
    function _settleMarkets(address owner, uint256 group) private {
        for (uint256 i; i < groupToMarkets[owner][group].length; i++)
            groupToMarkets[owner][group][i].settle(owner);
    }

    /// @dev overwrites rebalance configuration of all markets for a particular owner and group
    /// @param message already-verified message with new configuration
    /// @param owner identifies the owner of the collateral account
    function _updateRebalanceGroup(
        RebalanceConfigChange calldata message,
        address owner
    ) private {
        // ensure group index is valid
        if (message.group == 0 || message.group > MAX_GROUPS_PER_OWNER)
            revert ControllerInvalidRebalanceGroupError();

        if (message.markets.length > MAX_MARKETS_PER_GROUP)
            revert ControllerInvalidRebalanceMarketsError();

        // delete the existing group
        for (uint256 i; i < groupToMarkets[owner][message.group].length; i++) {
            address market = address(groupToMarkets[owner][message.group][i]);
            delete _rebalanceConfigs[owner][message.group][market];
            delete marketToGroup[owner][market];
        }
        delete groupToMarkets[owner][message.group];

        UFixed6 totalAllocation;
        for (uint256 i; i < message.markets.length; i++) {
            // ensure market is not pointing to a different group
            uint256 currentGroup = marketToGroup[owner][message.markets[i]];
            if (currentGroup != 0)
                revert ControllerMarketAlreadyInGroupError(IMarket(message.markets[i]), currentGroup);

            // rewrite over all the old configuration
            marketToGroup[owner][message.markets[i]] = message.group;
            _rebalanceConfigs[owner][message.group][message.markets[i]] = message.configs[i];
            groupToMarkets[owner][message.group].push(IMarket(message.markets[i]));
            groupToMaxRebalanceFee[owner][message.group] = message.maxFee;

            // ensure target allocation across all markets totals 100%
            // read from storage to trap duplicate markets in the message
            totalAllocation = totalAllocation.add(message.configs[i].target);

            emit RebalanceMarketConfigured(owner, message.group, message.markets[i], message.configs[i]);
        }

        // if not deleting the group, ensure rebalance targets add to 100%
        if (message.markets.length != 0 && !totalAllocation.eq(UFixed6Lib.ONE))
            revert ControllerInvalidRebalanceTargetsError();

        emit RebalanceGroupConfigured(owner, message.group, message.markets.length);
    }

    /// @notice Only an operator can call
    modifier onlyOperator(address owner, address operator) {
        if (!marketFactory.operators(owner, operator)) revert ControllerNotOperatorError();
        _;
    }
}
