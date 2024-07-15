// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import { IEmptySetReserve } from "@equilibria/emptyset-batcher/interfaces/IEmptySetReserve.sol";
import {
    AggregatorV3Interface,
    Kept_Arbitrum
} from "@equilibria/root/attribute/Kept/Kept_Arbitrum.sol";
import { Fixed6, Fixed6Lib } from "@equilibria/root/number/types/Fixed6.sol";
import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { Token6 } from "@equilibria/root/token/types/Token6.sol";
import { Token18, UFixed18 } from "@equilibria/root/token/types/Token18.sol";
import { IMarket } from "@equilibria/perennial-v2/contracts/interfaces/IMarket.sol";
import { IMarketFactory } from "@equilibria/perennial-v2/contracts/interfaces/IMarketFactory.sol";

import { IAccount } from "./interfaces/IAccount.sol";
import { IController } from "./interfaces/IController.sol";
import { IAccountVerifier } from "./interfaces/IAccountVerifier.sol";
import { Controller } from "./Controller.sol";
import { DeployAccount } from "./types/DeployAccount.sol";
import { MarketTransfer } from "./types/MarketTransfer.sol";
import { RebalanceConfigChange } from "./types/RebalanceConfigChange.sol";
import { Withdrawal } from "./types/Withdrawal.sol";

/// @title Controller_Arbitrum
/// @notice Controller which compensates keepers for processing messages on Arbitrum L2
contract Controller_Arbitrum is Controller, Kept_Arbitrum {
    KeepConfig public keepConfig;

    /// @dev Creates instance of Controller which compensates keepers
    /// @param implementation_ Pristine 0-initialized collateral account contract
    /// @param keepConfig_ Configuration used to compensate keepers
    constructor(address implementation_, KeepConfig memory keepConfig_) Controller(implementation_) {
        keepConfig = keepConfig_;
    }

    /// @notice Configures message verification and keeper compensation
    /// @param marketFactory_ Contract used to validate delegated signers
    /// @param verifier_ Contract used to validate collateral account message signatures
    /// @param chainlinkFeed_ ETH-USD price feed used for calculating keeper compensation
    function initialize(
        IMarketFactory marketFactory_,
        IAccountVerifier verifier_,
        AggregatorV3Interface chainlinkFeed_
    ) external initializer(1) {
        __Factory__initialize();
        __Kept__initialize(chainlinkFeed_, DSU);
        marketFactory = marketFactory_;
        verifier = verifier_;
    }

    /// @inheritdoc IController
    function changeRebalanceConfigWithSignature(
        RebalanceConfigChange calldata configChange,
        bytes calldata signature
    ) override external {
        _changeRebalanceConfigWithSignature(configChange, signature);
        // for this message, account address is only needed for keeper compensation
        IAccount account = IAccount(getAccountAddress(configChange.action.common.account));
        bytes memory data = abi.encode(address(account), configChange.action.maxFee);
        _handleKeeperFee(keepConfig, 0, msg.data[0:0], 0, data);
    }

    /// @inheritdoc IController
    function deployAccountWithSignature(
        DeployAccount calldata deployAccount_,
        bytes calldata signature
    ) override external {
        IAccount account = _deployAccountWithSignature(deployAccount_, signature);
        bytes memory data = abi.encode(address(account), deployAccount_.action.maxFee);
        _handleKeeperFee(keepConfig, 0, msg.data[0:0], 0, data);
    }

    /// @inheritdoc IController
    function marketTransferWithSignature(
        MarketTransfer calldata marketTransfer,
        bytes calldata signature
    ) override external {
        IAccount account = IAccount(getAccountAddress(marketTransfer.action.common.account));
        bytes memory data = abi.encode(account, marketTransfer.action.maxFee);

        // if we're depositing collateral to the market, pay the keeper before transferring funds
        if (marketTransfer.amount.gte(Fixed6Lib.ZERO)) {
            _handleKeeperFee(keepConfig, 0, msg.data[0:0], 0, data);
            _marketTransferWithSignature(account, marketTransfer, signature);
        // otherwise handle the keeper fee normally, after withdrawing to the collateral account
        } else {
            _marketTransferWithSignature(account, marketTransfer, signature);
            _handleKeeperFee(keepConfig, 0, msg.data[0:0], 0, data);
        }
    }

        /// @inheritdoc IController
    function rebalanceGroup(address owner, uint256 group) override external {
        _rebalanceGroup(owner, group);
        address account = getAccountAddress(owner);
        bytes memory data = abi.encode(account, groupToMaxRebalanceFee[owner][group]);
        _handleKeeperFee(keepConfig, 0, msg.data[0:0], 0, data);
    }

    /// @inheritdoc IController
    function withdrawWithSignature(
        Withdrawal calldata withdrawal,
        bytes calldata signature
    ) override external {
        address account = getAccountAddress(withdrawal.action.common.account);
        // levy fee prior to withdrawal
        bytes memory data = abi.encode(account, withdrawal.action.maxFee);
        _handleKeeperFee(keepConfig, 0, msg.data[0:0], 0, data);
        _withdrawWithSignature(IAccount(account), withdrawal, signature);
    }

    /// @dev Transfers funds from collateral account to controller, and limits compensation
    /// to the user-defined maxFee in the Action message
    /// @param amount Calculated keeper fee
    /// @param data Encoded address of collateral account and UFixed6 user-specified maximum fee
    /// @return raisedKeeperFee Amount pulled from controller to keeper
    function _raiseKeeperFee(
        UFixed18 amount,
        bytes memory data
    ) internal override returns (UFixed18 raisedKeeperFee) {
        (address account, uint256 maxFee) = abi.decode(data, (address, uint256));
        // maxFee is a UFixed6; convert to 18-decimal precision
        raisedKeeperFee = amount.min(UFixed18.wrap(maxFee * 1e12));

        // if the account has insufficient DSU to pay the fee, wrap
        if (DSU.balanceOf(account).lt(raisedKeeperFee)) {
            if (USDC.balanceOf(account).gte(UFixed6Lib.from(raisedKeeperFee)))
                IAccount(account).wrap(raisedKeeperFee);
            else
                revert ControllerCannotPayKeeperError();
        }

        // transfer DSU to the Controller, such that Kept can transfer to keeper
        DSU.pull(account, raisedKeeperFee);
    }
}
