// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { SignatureChecker } from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import { Common, CommonLib } from "@equilibria/root/verifier/types/Common.sol";
import { VerifierBase } from "@equilibria/root/verifier/VerifierBase.sol";
import { Initializable } from "@equilibria/root/attribute/Initializable.sol";

import { IVerifier } from "./interfaces/IVerifier.sol";
import { IMarketFactorySigners } from "./interfaces/IMarketFactorySigners.sol";
import { Fill, FillLib } from "./types/Fill.sol";
import { Intent, IntentLib } from "./types/Intent.sol";
import { Take, TakeLib } from "./types/Take.sol";
import { OperatorUpdate, OperatorUpdateLib } from "./types/OperatorUpdate.sol";
import { SignerUpdate, SignerUpdateLib } from "./types/SignerUpdate.sol";
import { AccessUpdateBatch, AccessUpdateBatchLib } from "./types/AccessUpdateBatch.sol";

/// @title Verifier
/// @notice Singleton ERC712 signed message verifier for the Perennial protocol.
/// @dev Handles nonce management for verified messages.
///       - nonce is a single use unique value per message that is invalidated after use
///       - group allows for an entire set of messages to be invalidated via a single cancel operation
///
///      Messages verification request must come from the domain address if it is set.
///       - In the case of intent / fills, this means that the market should be set as the domain.
///
contract Verifier is VerifierBase, IVerifier, Initializable {
    /// @dev market factory to check authorization
    IMarketFactorySigners public marketFactory;

    /// @dev Initializes the domain separator and parameter caches
    constructor() EIP712("Perennial", "1.0.0") { }

    /// @notice Initializes the contract state
    /// @param marketFactory_ The market factory
    function initialize(IMarketFactorySigners marketFactory_) external initializer(1) {
        marketFactory = marketFactory_;
    }

    /// @notice Verifies the signature of a request to fill an intent order
    function verifyFill(Fill calldata fill, bytes calldata signature)
        external
        validateAndCancel(fill.common, signature)
    {
        if (!SignatureChecker.isValidSignatureNow(
            fill.common.signer,
            _hashTypedDataV4(FillLib.hash(fill)),
            signature
        )) revert VerifierInvalidSignerError();
    }

    /// @notice Verifies the signature of an intent order type
    /// @dev Cancels the nonce after verifying the signature
    ///      Reverts if the signature does not match the signer
    /// @param intent The intent order to verify
    /// @param signature The signature of the taker for the intent order
    function verifyIntent(Intent calldata intent, bytes calldata signature)
        external
        validateAndCancel(intent.common, signature)
    {
        if (!SignatureChecker.isValidSignatureNow(
            intent.common.signer,
            _hashTypedDataV4(IntentLib.hash(intent)),
            signature
        )) revert VerifierInvalidSignerError();
    }

    /// @notice Verifies the signature of a market update taker type
    /// @dev Cancels the nonce after verifying the signature
    ///      Reverts if the signature does not match the signer
    /// @param marketUpdateTaker Message to verify
    /// @param signature Taker's signtaure
    function verifyTake(Take calldata marketUpdateTaker, bytes calldata signature)
        external
        validateAndCancel(marketUpdateTaker.common, signature)
    {
        if (!SignatureChecker.isValidSignatureNow(
            marketUpdateTaker.common.signer,
            _hashTypedDataV4(TakeLib.hash(marketUpdateTaker)),
            signature
        )) revert VerifierInvalidSignerError();
    }

    /// @notice Verifies the signature of a operator update type
    /// @dev Cancels the nonce after verifying the signature
    ///      Reverts if the signature does not match the signer
    /// @param operatorUpdate The operator update message to verify
    /// @param signature The signature of the account for the operator update
    function verifyOperatorUpdate(OperatorUpdate calldata operatorUpdate, bytes calldata signature)
        external
        validateAndCancel(operatorUpdate.common, signature)
    {
        if (!SignatureChecker.isValidSignatureNow(
            operatorUpdate.common.signer,
            _hashTypedDataV4(OperatorUpdateLib.hash(operatorUpdate)),
            signature
        )) revert VerifierInvalidSignerError();
    }

    /// @notice Verifies the signature of a signer update type
    /// @dev Cancels the nonce after verifying the signature
    ///      Reverts if the signature does not match the signer
    /// @param signerUpdate The signer update message to verify
    /// @param signature The signature of the account for the signer update
    function verifySignerUpdate(SignerUpdate calldata signerUpdate, bytes calldata signature)
        external
        validateAndCancel(signerUpdate.common, signature)
    {
        if (!SignatureChecker.isValidSignatureNow(
            signerUpdate.common.signer,
            _hashTypedDataV4(SignerUpdateLib.hash(signerUpdate)),
            signature
        )) revert VerifierInvalidSignerError();
    }

    /// @notice Verifies the signature of an access update batch type
    /// @dev Cancels the nonce after verifying the signature
    ///      Reverts if the signature does not match the signer
    /// @param accessUpdateBatch The batch access update (operator and signer) message to verify
    /// @param signature The signature of the account for the batch access update
    function verifyAccessUpdateBatch(AccessUpdateBatch calldata accessUpdateBatch, bytes calldata signature)
        external
        validateAndCancel(accessUpdateBatch.common, signature)
    {
        if (!SignatureChecker.isValidSignatureNow(
            accessUpdateBatch.common.signer,
            _hashTypedDataV4(AccessUpdateBatchLib.hash(accessUpdateBatch)),
            signature
        )) revert VerifierInvalidSignerError();
    }

    /// @notice Checks whether signer is allowed to sign a message for account
    /// @param account user to check authorization for
    /// @param signer address which signed a message for the account
    /// @return true if signer is authorized, otherwise false
    function _authorized(address account, address signer) internal view override returns (bool) {
        return super._authorized(account, signer) || marketFactory.signers(account, signer);
    }
}
