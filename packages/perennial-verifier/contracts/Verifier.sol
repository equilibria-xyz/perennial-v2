// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { Common, CommonLib } from "./types/Common.sol";
import { Intent, IntentLib } from "./types/Intent.sol";
import { Fill, FillLib } from "./types/Fill.sol";
import { GroupCancellation, GroupCancellationLib } from "./types/GroupCancellation.sol";
import { OperatorUpdate, OperatorUpdateLib } from "./types/OperatorUpdate.sol";
import { IVerifier } from "./interfaces/IVerifier.sol";

/// @title Verifier
/// @notice Singleton ERC712 signed message verifier for the Perennial protocol.
/// @dev Handles nonce management for verified messages.
///       - nonce is a single use unique value per message that is invalidated after use
///       - group allows for an entire set of messages to be invalidated via a single cancel operation
///
///      Messages verification request must come from the domain address if it is set.
///       - In the case of intent / fills, this means that the market should be set as the domain.
///
contract Verifier is IVerifier, EIP712 {
    /// @dev mapping of nonces per account and their cancelled state
    mapping(address => mapping(uint256 => bool)) public nonces;

    /// @dev mapping of group nonces per account and their cancelled state
    mapping(address => mapping(uint256 => bool)) public groups;

    constructor() EIP712("Perennial", "1.0.0") { }

    /// @notice Verifies the signature of no-op common message
    /// @dev Cancels the nonce after verifying the signature
    /// @param common The common data of the message
    /// @param signature The signature of the account for the message
    /// @return The address corresponding to the signature
    function verifyCommon(Common calldata common, bytes calldata signature)
        external
        validateAndCancel(common, signature) returns (address)
    {
        return ECDSA.recover(_hashTypedDataV4(CommonLib.hash(common)), signature);
    }

    /// @notice Verifies the signature of an intent order type
    /// @dev Cancels the nonce after verifying the signature
    /// @param intent The intent order to verify
    /// @param signature The signature of the taker for the intent order
    /// @return The address corresponding to the signature
    function verifyIntent(Intent calldata intent, bytes calldata signature)
        external
        validateAndCancel(intent.common, signature) returns (address)
    {
        return ECDSA.recover(_hashTypedDataV4(IntentLib.hash(intent)), signature);
    }

    /// @notice Verifies the signature of a intent order fill type
    /// @dev Cancels the nonce after verifying the signature
    /// @param fill The intent order fill to verify
    /// @param signature The signature of the maker for the intent order fill
    /// @return The address corresponding to the signature
    function verifyFill(Fill calldata fill, bytes calldata signature)
        external
        validateAndCancel(fill.common, signature) returns (address)
    {
        return ECDSA.recover(_hashTypedDataV4(FillLib.hash(fill)), signature);
    }

    /// @notice Verifies the signature of a group cancellation type
    /// @dev Cancels the nonce after verifying the signature
    /// @param groupCancellation The group cancellation to verify
    /// @param signature The signature of the account for the group cancellation
    /// @return The address corresponding to the signature
    function verifyGroupCancellation(GroupCancellation calldata groupCancellation, bytes calldata signature)
        external
        validateAndCancel(groupCancellation.common, signature) returns (address)
    {
        return ECDSA.recover(_hashTypedDataV4(GroupCancellationLib.hash(groupCancellation)), signature);
    }

    /// @notice Verifies the signature of a operator approval type
    /// @dev Cancels the nonce after verifying the signature
    /// @param operatorUpdate The operator approval message to verify
    /// @param signature The signature of the account for the operator approval
    /// @return The address corresponding to the signature
    function verifyOperatorUpdate(OperatorUpdate calldata operatorUpdate, bytes calldata signature)
        external
        validateAndCancel(operatorUpdate.common, signature) returns (address)
    {
        return ECDSA.recover(_hashTypedDataV4(OperatorUpdateLib.hash(operatorUpdate)), signature);
    }

    /// @notice Cancels a nonce
    /// @param nonce The nonce to cancel
    function cancelNonce(uint256 nonce) external {
        _cancelNonce(msg.sender, nonce);
    }

    /// @notice Cancels a group nonce
    /// @param group The group nonce to cancel
    function cancelGroup(uint256 group) external {
        _cancelGroup(msg.sender, group);
    }

    /// @notice Cancels a nonce for an account via a signed message
    /// @dev Process a no-op message that will invalidate the specified nonce
    /// @param common The common data of the message
    /// @param signature The signature of the account for the message
    function cancelNonceWithSignature(Common calldata common, bytes calldata signature) external {
        address signer = IVerifier(this).verifyCommon(common, signature);
        if (signer != common.account) revert VerifierInvalidSignerError();
    }

    /// @notice Cancels a group for an account via a signed message
    /// @param groupCancellation The group cancellation message
    /// @param signature The signature of the account for the group cancellation
    function cancelGroupWithSignature(GroupCancellation calldata groupCancellation, bytes calldata signature) external {
        address signer = IVerifier(this).verifyGroupCancellation(groupCancellation, signature);
        if (signer != groupCancellation.common.account) revert VerifierInvalidSignerError();

        _cancelGroup(groupCancellation.common.account, groupCancellation.group);
    }

    /// @notice Cancels a nonce
    /// @param account The account to cancel the nonce for
    /// @param nonce The nonce to cancel
    function _cancelNonce(address account, uint256 nonce) private {
        nonces[account][nonce] = true;
        emit NonceCancelled(account, nonce);
    }

    /// @notice Cancels a group nonce
    /// @param account The account to cancel the group nonce for
    /// @param group The group nonce to cancel
    function _cancelGroup(address account, uint256 group) private {
        groups[account][group] = true;
        emit GroupCancelled(account, group);
    }

    /// @dev Validates the common data of a message
    modifier validateAndCancel(Common calldata common, bytes calldata signature) {
        if (common.domain != msg.sender) revert VerifierInvalidDomainError();
        if (signature.length != 65) revert VerifierInvalidSignatureError();
        if (nonces[common.account][common.nonce]) revert VerifierInvalidNonceError();
        if (groups[common.account][common.group]) revert VerifierInvalidGroupError();
        if (block.timestamp >= common.expiry) revert VerifierInvalidExpiryError();

        _cancelNonce(common.account, common.nonce);

        _;
    }
}
