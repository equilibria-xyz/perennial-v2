// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { SignatureChecker } from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Common, CommonLib } from "@equilibria/root/verifier/types/Common.sol";
import { VerifierBase } from "@equilibria/root/verifier/VerifierBase.sol";

import { IVerifier } from "./interfaces/IVerifier.sol";
import { IMarketFactory } from "./interfaces/IMarketFactory.sol";
import { Intent, IntentLib } from "./types/Intent.sol";
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
contract Verifier is VerifierBase, IVerifier, Ownable {
    /// @dev market factory to check authorization
    IMarketFactory internal marketFactory;

    /// @dev Initializes the domain separator and parameter caches
    constructor() EIP712("Perennial", "1.0.0") { }

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

    /// @notice Updates market factory contract
    /// @param _marketFactory address of market factory contract
    function updateMarketFactory(IMarketFactory _marketFactory) external onlyOwner {
        if (address(_marketFactory) == address(0)) {
            revert VerifierMarketFactoryZeroAddressError();
        }
        marketFactory = _marketFactory;
    }

    /// @notice Checks account authorization
    /// @param account the account to check authorization for
    /// @param signer the signer of the account
    function _authorized(address account, address signer) internal override {
        (bool isOperator, bool isSigner, ) = marketFactory.authorization(account, address(0), signer, address(0));
        if (!isSigner && !isOperator) revert VerifierInvalidSignerError();
    }
}
