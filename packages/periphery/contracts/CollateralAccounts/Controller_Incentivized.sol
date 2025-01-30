// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { AggregatorV3Interface } from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import { IEmptySetReserve } from "@equilibria/emptyset-batcher/interfaces/IEmptySetReserve.sol";
import { Kept } from "@equilibria/root/attribute/Kept/Kept.sol";
import { Fixed6, Fixed6Lib } from "@equilibria/root/number/types/Fixed6.sol";
import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { UFixed18, UFixed18Lib } from "@equilibria/root/number/types/UFixed18.sol";
import { Token6 } from "@equilibria/root/token/types/Token6.sol";
import { Token18 } from "@equilibria/root/token/types/Token18.sol";
import { IVerifierBase } from "@equilibria/root/verifier/interfaces/IVerifierBase.sol";
import { IMarket } from "@perennial/v2-core/contracts/interfaces/IMarket.sol";
import { IMarketFactory } from "@perennial/v2-core/contracts/interfaces/IMarketFactory.sol";

import { IAccount } from "./interfaces/IAccount.sol";
import { IController } from "./interfaces/IController.sol";
import { IRelayer } from "./interfaces/IRelayer.sol";
import { Controller, IAccountVerifier } from "./Controller.sol";
import { Action } from "./types/Action.sol";
import { DeployAccount } from "./types/DeployAccount.sol";
import { MarketTransfer } from "./types/MarketTransfer.sol";
import { RebalanceConfigChange } from "./types/RebalanceConfigChange.sol";
import { RelayedTake } from "./types/RelayedTake.sol";
import { RelayedNonceCancellation } from "./types/RelayedNonceCancellation.sol";
import { RelayedGroupCancellation } from "./types/RelayedGroupCancellation.sol";
import { RelayedOperatorUpdate } from "./types/RelayedOperatorUpdate.sol";
import { RelayedSignerUpdate } from "./types/RelayedSignerUpdate.sol";
import { RelayedAccessUpdateBatch } from "./types/RelayedAccessUpdateBatch.sol";
import { Withdrawal } from "./types/Withdrawal.sol";

/// @title Controller_Incentivized
/// @notice Controller which compensates keepers for handling or relaying messages. Subclass to handle differences in
/// gas calculations on different chains.
abstract contract Controller_Incentivized is Controller, IRelayer, Kept {
    /// @dev Handles relayed messages for nonce cancellation
    IVerifierBase public immutable nonceManager;

    /// @dev Configuration used to calculate keeper compensation
    KeepConfig public keepConfig;

    /// @dev Configuration used to calculate keeper compensation with buffered gas
    KeepConfig public keepConfigBuffered;

    /// @dev Configuration used to calculate keeper compensation to withdraw from a collateral account
    KeepConfig public keepConfigWithdrawal;

    /// @dev Creates instance of Controller which compensates keepers
    /// @param implementation_ Pristine collateral account contract
    /// @param marketFactory_ Market factory contract
    /// @param nonceManager_ Verifier contract to which nonce and group cancellations are relayed
    constructor(
        address implementation_,
        IMarketFactory marketFactory_,
        IVerifierBase nonceManager_
    ) Controller(implementation_, marketFactory_) {
        nonceManager = nonceManager_;
    }

    /// @notice Configures message verification and keeper compensation
    /// @param verifier_ Contract used to validate collateral account message signatures
    /// @param chainlinkFeed_ ETH-USD price feed used for calculating keeper compensation
    /// @param keepConfig_ Configuration used for unbuffered keeper compensation
    /// @param keepConfigBuffered_ Configuration used for buffered keeper compensation
    /// @param keepConfigWithdrawal_ Configuration used to compensate keepers for withdrawals
    function initialize(
        IAccountVerifier verifier_,
        AggregatorV3Interface chainlinkFeed_,
        KeepConfig memory keepConfig_,
        KeepConfig memory keepConfigBuffered_,
        KeepConfig memory keepConfigWithdrawal_
    ) external initializer(1) {
        __Factory__initialize();
        __Kept__initialize(chainlinkFeed_, DSU);
        verifier = verifier_;
        keepConfig = keepConfig_;
        keepConfigBuffered = keepConfigBuffered_;
        keepConfigWithdrawal = keepConfigWithdrawal_;
    }

    /// @inheritdoc IController
    function changeRebalanceConfigWithSignature(
        RebalanceConfigChange calldata configChange,
        bytes calldata signature
    )
        external
        override
        keepCollateralAccount(
            configChange.action.common.account,
            abi.encode(configChange, signature),
            configChange.action.maxFee,
            0
        )
    {
        _changeRebalanceConfigWithSignature(configChange, signature);
    }

    /// @inheritdoc IController
    function deployAccountWithSignature(
        DeployAccount calldata deployAccount_,
        bytes calldata signature
    )
        external
        override
        keepCollateralAccount(
            deployAccount_.action.common.account,
            abi.encode(deployAccount_, signature),
            deployAccount_.action.maxFee,
            0
        )
    {
        _deployAccountWithSignature(deployAccount_, signature);
    }

    /// @inheritdoc IController
    function marketTransferWithSignature(
        MarketTransfer calldata marketTransfer,
        bytes calldata signature
    )
        external
        override
        keepCollateralAccount(
            marketTransfer.action.common.account,
            abi.encode(marketTransfer, signature),
            marketTransfer.action.maxFee,
            1
        )
    {
        IAccount account = IAccount(getAccountAddress(marketTransfer.action.common.account));
        _marketTransferWithSignature(account, marketTransfer, signature);
    }

    /// @inheritdoc IController
    function rebalanceGroup(
        address owner,
        uint256 group
    )
        external
        override
        keepCollateralAccount(
            owner,
            abi.encode(owner, group),
            groupToMaxRebalanceFee[owner][group],
            groupToMarkets[owner][group].length
        )
    {
        _rebalanceGroup(owner, group);
    }

    /// @inheritdoc IController
    function withdrawWithSignature(
        Withdrawal calldata withdrawal,
        bytes calldata signature
    ) override external {
        address account = getAccountAddress(withdrawal.action.common.account);
        // levy fee prior to withdrawal
        bytes memory data = abi.encode(account, withdrawal.action.maxFee);
        _handleKeeperFee(
            keepConfigWithdrawal,
            0, // no way to calculate applicable gas prior to invocation
            abi.encode(withdrawal, signature),
            0,
            data
        );
        _withdrawWithSignature(IAccount(account), withdrawal, signature);
    }

    /// @inheritdoc IRelayer
    function relayTake(
        RelayedTake calldata message,
        bytes calldata outerSignature,
        bytes calldata innerSignature
    )
        external
        override
        keepCollateralAccount(
            message.take.common.account,
            abi.encode(message, outerSignature, innerSignature),
            message.action.maxFee,
            0
        )
    {
        // ensure the message was signed by the owner or a delegated signer
        verifier.verifyRelayedTake(message, outerSignature);

        // relay the message to Market
        IMarket market = IMarket(message.take.common.domain);
        market.update(message.take, innerSignature);
    }

    /// @inheritdoc IRelayer
    function relayNonceCancellation(
        RelayedNonceCancellation calldata message,
        bytes calldata outerSignature,
        bytes calldata innerSignature
    )
        external
        override
        keepCollateralAccount(
            message.action.common.account,
            abi.encode(message, outerSignature, innerSignature),
            message.action.maxFee,
            0
        )
    {
        // ensure the message was signed by the owner or a delegated signer
        verifier.verifyRelayedNonceCancellation(message, outerSignature);

        // relay the message to Verifier
        nonceManager.cancelNonceWithSignature(message.nonceCancellation, innerSignature);
    }

    /// @inheritdoc IRelayer
    function relayGroupCancellation(
        RelayedGroupCancellation calldata message,
        bytes calldata outerSignature,
        bytes calldata innerSignature
    )
        external
        override
        keepCollateralAccount(
            message.action.common.account,
            abi.encode(message, outerSignature, innerSignature),
            message.action.maxFee,
            0
        )
    {
        // ensure the message was signed by the owner or a delegated signer
        verifier.verifyRelayedGroupCancellation(message, outerSignature);

        // relay the message to Verifier
        nonceManager.cancelGroupWithSignature(message.groupCancellation, innerSignature);
    }

    /// @inheritdoc IRelayer
    function relayOperatorUpdate(
        RelayedOperatorUpdate calldata message,
        bytes calldata outerSignature,
        bytes calldata innerSignature
    )
        external
        override
        keepCollateralAccount(
            message.action.common.account,
            abi.encode(message, outerSignature, innerSignature),
            message.action.maxFee,
            0
        )
    {
        // ensure the message was signed by the owner or a delegated signer
        verifier.verifyRelayedOperatorUpdate(message, outerSignature);

        // relay the message to MarketFactory
        marketFactory.updateOperatorWithSignature(message.operatorUpdate, innerSignature);
    }

    /// @inheritdoc IRelayer
    function relaySignerUpdate(
        RelayedSignerUpdate calldata message,
        bytes calldata outerSignature,
        bytes calldata innerSignature
    )
        external
        override
        keepCollateralAccount(
            message.action.common.account,
            abi.encode(message, outerSignature, innerSignature),
            message.action.maxFee,
            0
        )
    {
        // ensure the message was signed by the owner or a delegated signer
        verifier.verifyRelayedSignerUpdate(message, outerSignature);

        // relay the message to MarketFactory
        marketFactory.updateSignerWithSignature(message.signerUpdate, innerSignature);
    }

    /// @inheritdoc IRelayer
    function relayAccessUpdateBatch(
        RelayedAccessUpdateBatch calldata message,
        bytes calldata outerSignature,
        bytes calldata innerSignature
    )
        external
        override
        keepCollateralAccount(
            message.action.common.account,
            abi.encode(message, outerSignature, innerSignature),
            message.action.maxFee,
            0
        )
    {
        // ensure the message was signed by the owner or a delegated signer
        verifier.verifyRelayedAccessUpdateBatch(message, outerSignature);

        // relay the message to MarketFactory
        marketFactory.updateAccessBatchWithSignature(message.accessUpdateBatch, innerSignature);
    }

    /// @dev Transfers funds from collateral account to controller, and limits compensation
    /// to the user-defined maxFee in the Action message
    /// @param amount Calculated keeper fee
    /// @param data Encoded address of collateral account and UFixed6 user-specified maximum fee
    /// @return raisedKeeperFee Amount pulled from controller to keeper
    function _raiseKeeperFee(
        UFixed18 amount,
        bytes memory data
    ) internal virtual override returns (UFixed18 raisedKeeperFee) {
        (address account, UFixed6 maxFee) = abi.decode(data, (address, UFixed6));
        raisedKeeperFee = amount.min(UFixed18Lib.from(maxFee));

        // if the account has insufficient DSU to pay the fee, wrap
        IAccount(account).wrapIfNecessary(raisedKeeperFee, false);

        // transfer DSU to the Controller, such that Kept can transfer to keeper
        DSU.pull(account, raisedKeeperFee);
    }

    modifier keepCollateralAccount(
        address account,
        bytes memory applicableCalldata,
        UFixed6 maxFee,
        uint256 bufferMultiplier
    ) {
        bytes memory data = abi.encode(getAccountAddress(account), maxFee);
        uint256 startGas = gasleft();

        _;

        uint256 applicableGas = startGas - gasleft();

        _handleKeeperFee(
            bufferMultiplier > 0
                ? KeepConfig(
                    keepConfigBuffered.multiplierBase,
                    keepConfigBuffered.bufferBase * (bufferMultiplier),
                    keepConfigBuffered.multiplierCalldata,
                    keepConfigBuffered.bufferCalldata * (bufferMultiplier)
                )
                : keepConfig,
            applicableGas,
            applicableCalldata,
            0,
            data
        );
    }
}
