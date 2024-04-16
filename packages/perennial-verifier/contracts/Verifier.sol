// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { Common } from "./types/Common.sol";
import { Intent, IntentLib } from "./types/Intent.sol";
import { Fill, FillLib } from "./types/Fill.sol";
import { IVerifier } from "./interfaces/IVerifier.sol";

// TODO: permit cancel nonce / group
// TODO: permit operator approval

/// @title Verifier
/// @notice TODO
contract Verifier is IVerifier, EIP712 {
    mapping(address => mapping(bytes32 => bool)) public nonces;
    mapping(address => mapping(bytes32 => bool)) public groups;

    constructor() EIP712("Perennial", "1.0.0") { }

    /// @notice Verifies the signature of an intent order type
    /// @dev Cancels the nonce after verifying the signature
    /// @param intent The intent order to verify
    /// @param signature The signature of the taker for the intent order
    /// @return The address corresponding to the signature
    function verifyIntent(Intent calldata intent, bytes calldata signature)
        external // TODO: this needs permissioning then??
        validate(intent.common, signature) returns (address)
    {
        return ECDSA.recover(_hashTypedDataV4(IntentLib.hash(intent)), signature);
    }

    /// @notice Verifies the signature of a intent order fill type
    /// @dev Cancels the nonce after verifying the signature
    /// @param fill The intent order fill to verify
    /// @param signature The signature of the maker for the intent order fill
    /// @return The address corresponding to the signature
    function verifyFill(Fill calldata fill, bytes calldata signature)
        external // TODO: this needs permissioning then??
        validate(fill.common, signature) returns (address)
    {
        return ECDSA.recover(_hashTypedDataV4(FillLib.hash(fill)), signature);
    }

    function cancelNonce(bytes32 nonce) external {
        nonces[msg.sender][nonce] = true;
    }

    function cancelGroup(bytes32 group) external {
        nonces[msg.sender][group] = true;
    }

    modifier validate(Common calldata common, bytes calldata signature) {
        if (signature.length != 65) revert VerifierInvalidSignatureError();
        if (nonces[common.account][common.nonce]) revert VerifierInvalidNonceError();
        if (groups[common.account][common.group]) revert VerifierInvalidGroupError();
        if (common.expiry != 0 && block.timestamp > common.expiry) revert VerifierInvalidExpiryError();

        nonces[common.account][common.nonce] = true;

        _;
    }
}
