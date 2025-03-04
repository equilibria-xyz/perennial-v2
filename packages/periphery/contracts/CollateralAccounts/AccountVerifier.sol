// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { SignatureChecker } from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import { VerifierBase } from "@equilibria/root/verifier/VerifierBase.sol";
import { IMarketFactory } from "@perennial/v2-core/contracts/interfaces/IMarketFactory.sol";

import { IAccountVerifier } from "./interfaces/IAccountVerifier.sol";
import { IRelayVerifier } from "./interfaces/IRelayVerifier.sol"; // only needed for docstrings
import { Action, ActionLib } from "./types/Action.sol";
import { DeployAccount, DeployAccountLib } from "./types/DeployAccount.sol";
import { MarketTransfer, MarketTransferLib } from "./types/MarketTransfer.sol";
import { RebalanceConfigChange, RebalanceConfigChangeLib } from "./types/RebalanceConfigChange.sol";
import { Withdrawal, WithdrawalLib } from "./types/Withdrawal.sol";
import { RelayedTake, RelayedTakeLib } from "./types/RelayedTake.sol";
import { RelayedNonceCancellation, RelayedNonceCancellationLib } from "./types/RelayedNonceCancellation.sol";
import { RelayedGroupCancellation, RelayedGroupCancellationLib } from "./types/RelayedGroupCancellation.sol";
import { RelayedOperatorUpdate, RelayedOperatorUpdateLib } from "./types/RelayedOperatorUpdate.sol";
import { RelayedSignerUpdate, RelayedSignerUpdateLib } from "./types/RelayedSignerUpdate.sol";
import { RelayedAccessUpdateBatch, RelayedAccessUpdateBatchLib } from "./types/RelayedAccessUpdateBatch.sol";

/// @title Verifier
/// @notice ERC712 signed message verifier for the Perennial V2 Collateral Accounts package.
contract AccountVerifier is VerifierBase, IAccountVerifier {
    /// @dev market factory to check authorization
    IMarketFactory internal immutable marketFactory;

    /// @dev Initializes the domain separator and parameter caches
    constructor(IMarketFactory _marketFactory) EIP712("Perennial V2 Collateral Accounts", "1.0.0") {
        marketFactory = _marketFactory;
    }

    /// @inheritdoc IAccountVerifier
    function verifyAction(Action calldata action, bytes calldata signature)
        external
        validateAndCancel(action.common, signature) {
        if (!SignatureChecker.isValidSignatureNow(
            action.common.signer,
            _hashTypedDataV4(ActionLib.hash(action)),
            signature
        )) revert VerifierInvalidSignerError();
    }

    /// @inheritdoc IAccountVerifier
    function verifyDeployAccount(DeployAccount calldata deployAccount, bytes calldata signature)
        external
        validateAndCancel(deployAccount.action.common, signature) {
        if (!SignatureChecker.isValidSignatureNow(
            deployAccount.action.common.signer,
            _hashTypedDataV4(DeployAccountLib.hash(deployAccount)),
            signature
        )) revert VerifierInvalidSignerError();
    }

    /// @inheritdoc IAccountVerifier
    function verifyMarketTransfer(MarketTransfer calldata marketTransfer, bytes calldata signature)
        external
        validateAndCancel(marketTransfer.action.common, signature) {
        if (!SignatureChecker.isValidSignatureNow(
            marketTransfer.action.common.signer,
            _hashTypedDataV4(MarketTransferLib.hash(marketTransfer)),
            signature
        )) revert VerifierInvalidSignerError();
    }

    /// @inheritdoc IAccountVerifier
    function verifyRebalanceConfigChange(RebalanceConfigChange calldata change, bytes calldata signature)
        external
        validateAndCancel(change.action.common, signature) {
        if (!SignatureChecker.isValidSignatureNow(
            change.action.common.signer,
            _hashTypedDataV4(RebalanceConfigChangeLib.hash(change)),
            signature
        )) revert VerifierInvalidSignerError();
    }

    /// @inheritdoc IAccountVerifier
    function verifyWithdrawal(Withdrawal calldata withdrawal, bytes calldata signature)
        external
        validateAndCancel(withdrawal.action.common, signature) {
        if (!SignatureChecker.isValidSignatureNow(
            withdrawal.action.common.signer,
            _hashTypedDataV4(WithdrawalLib.hash(withdrawal)),
            signature
        )) revert VerifierInvalidSignerError();
    }

    /// @inheritdoc IRelayVerifier
    function verifyRelayedTake(
        RelayedTake calldata message,
        bytes calldata outerSignature
    ) external validateAndCancel(message.action.common, outerSignature) {
        if (!SignatureChecker.isValidSignatureNow(
            message.action.common.signer,
            _hashTypedDataV4(RelayedTakeLib.hash(message)),
            outerSignature
        )) revert VerifierInvalidSignerError();
    }

    /// @inheritdoc IRelayVerifier
    function verifyRelayedNonceCancellation(
        RelayedNonceCancellation calldata message,
        bytes calldata outerSignature
    ) external validateAndCancel(message.action.common, outerSignature) {
        if (!SignatureChecker.isValidSignatureNow(
            message.action.common.signer,
            _hashTypedDataV4(RelayedNonceCancellationLib.hash(message)),
            outerSignature
        )) revert VerifierInvalidSignerError();
    }

    /// @inheritdoc IRelayVerifier
    function verifyRelayedGroupCancellation(
        RelayedGroupCancellation calldata message,
        bytes calldata outerSignature
    ) external validateAndCancel(message.action.common, outerSignature) {
        if (!SignatureChecker.isValidSignatureNow(
            message.action.common.signer,
            _hashTypedDataV4(RelayedGroupCancellationLib.hash(message)),
            outerSignature
        )) revert VerifierInvalidSignerError();
    }

    /// @inheritdoc IRelayVerifier
    function verifyRelayedOperatorUpdate(
        RelayedOperatorUpdate calldata message,
        bytes calldata outerSignature
    ) external validateAndCancel(message.action.common, outerSignature) {
        if (!SignatureChecker.isValidSignatureNow(
            message.action.common.signer,
            _hashTypedDataV4(RelayedOperatorUpdateLib.hash(message)),
            outerSignature
        )) revert VerifierInvalidSignerError();
    }

    /// @inheritdoc IRelayVerifier
    function verifyRelayedSignerUpdate(
        RelayedSignerUpdate calldata message,
        bytes calldata outerSignature
    ) external validateAndCancel(message.action.common, outerSignature) {
        if (!SignatureChecker.isValidSignatureNow(
            message.action.common.signer,
            _hashTypedDataV4(RelayedSignerUpdateLib.hash(message)),
            outerSignature
        )) revert VerifierInvalidSignerError();
    }

    /// @inheritdoc IRelayVerifier
    function verifyRelayedAccessUpdateBatch(
        RelayedAccessUpdateBatch calldata message,
        bytes calldata outerSignature
    ) external validateAndCancel(message.action.common, outerSignature) {
        if (!SignatureChecker.isValidSignatureNow(
            message.action.common.signer,
            _hashTypedDataV4(RelayedAccessUpdateBatchLib.hash(message)),
            outerSignature
        )) revert VerifierInvalidSignerError();
    }

    /// @notice Checks whether signer is allowed to sign a message for account
    /// @param account user to check authorization for (not the collateral account)
    /// @param signer address which signed a message for the account
    /// @return true if signer is authorized, otherwise false
    function _authorized(address account, address signer) internal view override returns (bool) {
        return super._authorized(account, signer) || marketFactory.signers(account, signer);
    }
}
