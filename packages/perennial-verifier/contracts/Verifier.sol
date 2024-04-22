// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { Common } from "./types/Common.sol";
import { Intent, IntentLib } from "./types/Intent.sol";
import { Fill, FillLib } from "./types/Fill.sol";
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
        if (common.domain != address(0) && common.domain != msg.sender) revert VerifierInvalidDomainError();
        if (signature.length != 65) revert VerifierInvalidSignatureError();
        if (nonces[common.account][common.nonce]) revert VerifierInvalidNonceError();
        if (groups[common.account][common.group]) revert VerifierInvalidGroupError();
        if (common.expiry != 0 && block.timestamp >= common.expiry) revert VerifierInvalidExpiryError();

        _cancelNonce(common.account, common.nonce);

        _;
    }
}
