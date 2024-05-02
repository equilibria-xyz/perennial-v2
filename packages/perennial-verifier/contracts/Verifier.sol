// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { Common, CommonLib } from "@equilibria/root/verifier/types/Common.sol";
import { VerifierBase } from "@equilibria/root/verifier/VerifierBase.sol";

import { IVerifier } from "./interfaces/IVerifier.sol";
import { Intent, IntentLib } from "./types/Intent.sol";
import { Fill, FillLib } from "./types/Fill.sol";
import { OperatorUpdate, OperatorUpdateLib } from "./types/OperatorUpdate.sol";

/// @title Verifier
/// @notice Singleton ERC712 signed message verifier for the Perennial protocol.
/// @dev Handles nonce management for verified messages.
///       - nonce is a single use unique value per message that is invalidated after use
///       - group allows for an entire set of messages to be invalidated via a single cancel operation
///
///      Messages verification request must come from the domain address if it is set.
///       - In the case of intent / fills, this means that the market should be set as the domain.
///
contract Verifier is VerifierBase, IVerifier {
    /// @dev Initializes the domain separator and parameter caches
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
}
