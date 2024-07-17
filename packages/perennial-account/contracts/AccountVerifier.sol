// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { SignatureChecker } from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import { VerifierBase } from "@equilibria/root/verifier/VerifierBase.sol";

import { IAccountVerifier, IRelayVerifier, ILocalVerifier } from "./interfaces/ILocalVerifier.sol";
import { Action, ActionLib } from "./types/Action.sol";
import { DeployAccount, DeployAccountLib } from "./types/DeployAccount.sol";
import { MarketTransfer, MarketTransferLib } from "./types/MarketTransfer.sol";
import { RebalanceConfigChange, RebalanceConfigChangeLib } from "./types/RebalanceConfigChange.sol";
import { Withdrawal, WithdrawalLib } from "./types/Withdrawal.sol";
import { RelayedNonceCancellation, RelayedNonceCancellationLib } from "./types/RelayedNonceCancellation.sol";
import { RelayedSignerUpdate, RelayedSignerUpdateLib } from "./types/RelayedSignerUpdate.sol";

/// @title Verifier
/// @notice ERC712 signed message verifier for the Perennial V2 Collateral Accounts package.
contract AccountVerifier is VerifierBase, ILocalVerifier {
    /// @dev Initializes the domain separator and parameter caches
    constructor() EIP712("Perennial V2 Collateral Accounts", "1.0.0") { }

    /// @inheritdoc IAccountVerifier
    function verifyAction(Action calldata action, bytes calldata signature)
        external
        validateAndCancel(action.common, signature)
    {
        if (!SignatureChecker.isValidSignatureNow(
            action.common.signer,
            _hashTypedDataV4(ActionLib.hash(action)),
            signature
        )) revert VerifierInvalidSignerError();
    }

    /// @inheritdoc IAccountVerifier
    function verifyDeployAccount(DeployAccount calldata deployAccount, bytes calldata signature)
        external
        validateAndCancel(deployAccount.action.common, signature)
    {
        if (!SignatureChecker.isValidSignatureNow(
            deployAccount.action.common.signer,
            _hashTypedDataV4(DeployAccountLib.hash(deployAccount)),
            signature
        )) revert VerifierInvalidSignerError();
    }

    /// @inheritdoc IAccountVerifier
    function verifyMarketTransfer(MarketTransfer calldata marketTransfer, bytes calldata signature)
        external
        validateAndCancel(marketTransfer.action.common, signature)
    {
        if (!SignatureChecker.isValidSignatureNow(
            marketTransfer.action.common.signer,
            _hashTypedDataV4(MarketTransferLib.hash(marketTransfer)),
            signature
        )) revert VerifierInvalidSignerError();
    }

    /// @inheritdoc IAccountVerifier
    function verifyRebalanceConfigChange(RebalanceConfigChange calldata change, bytes calldata signature)
        external
        validateAndCancel(change.action.common, signature)
    {
        if (!SignatureChecker.isValidSignatureNow(
            change.action.common.signer,
            _hashTypedDataV4(RebalanceConfigChangeLib.hash(change)),
            signature
        )) revert VerifierInvalidSignerError();
    }

    /// @inheritdoc IAccountVerifier
    function verifyWithdrawal(Withdrawal calldata withdrawal, bytes calldata signature)
        external
        validateAndCancel(withdrawal.action.common, signature)
    {
        if (!SignatureChecker.isValidSignatureNow(
            withdrawal.action.common.signer,
            _hashTypedDataV4(WithdrawalLib.hash(withdrawal)),
            signature
        )) revert VerifierInvalidSignerError();
    }

    /// @inheritdoc IRelayVerifier
    function verifyRelayedNonceCancellation(
        RelayedNonceCancellation calldata relayedMessage,
        bytes calldata outerSignature
    ) external validateAndCancel(relayedMessage.action.common, outerSignature)
    {
        if (!SignatureChecker.isValidSignatureNow(
            relayedMessage.action.common.signer,
            _hashTypedDataV4(RelayedNonceCancellationLib.hash(relayedMessage)),
            outerSignature
        )) revert VerifierInvalidSignerError();
    }

    /// @inheritdoc IRelayVerifier
    function verifyRelayedSignerUpdate(
        RelayedSignerUpdate calldata relayedMessage,
        bytes calldata outerSignature
    ) external validateAndCancel(relayedMessage.action.common, outerSignature)
    {
        if (!SignatureChecker.isValidSignatureNow(
            relayedMessage.action.common.signer,
            _hashTypedDataV4(RelayedSignerUpdateLib.hash(relayedMessage)),
            outerSignature
        )) revert VerifierInvalidSignerError();
    }
}
