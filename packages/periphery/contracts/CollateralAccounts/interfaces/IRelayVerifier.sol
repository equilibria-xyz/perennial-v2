// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { IVerifierBase } from "@equilibria/root/verifier/interfaces/IVerifierBase.sol";
import { RelayedTake } from "../types/RelayedTake.sol";
import { RelayedNonceCancellation } from "../types/RelayedNonceCancellation.sol";
import { RelayedGroupCancellation } from "../types/RelayedGroupCancellation.sol";
import { RelayedOperatorUpdate } from "../types/RelayedOperatorUpdate.sol";
import { RelayedSignerUpdate } from "../types/RelayedSignerUpdate.sol";
import { RelayedAccessUpdateBatch } from "../types/RelayedAccessUpdateBatch.sol";

/// @notice EIP712 signed message verifier for relaying messages through Collateral Accounts Controller.
interface IRelayVerifier is IVerifierBase {
    /// @dev Verifies a request to relay an update to a taker position in a market
    /// @param message Wrapped message adding details needed for keeper compensation
    /// @param outerSignature EIP712 signature for the preceeding message
    function verifyRelayedTake(
        RelayedTake calldata message,
        bytes calldata outerSignature
    ) external;

    /// @dev Verifies a request to relay a nonce cancellation request
    /// @param message Wrapped message adding details needed for keeper compensation
    /// @param outerSignature EIP712 signature for the preceeding message
    function verifyRelayedNonceCancellation(
        RelayedNonceCancellation calldata message,
        bytes calldata outerSignature
    ) external;

    /// @dev Verifies a request to relay a group nonce cancellation request
    /// @param message Wrapped message adding details needed for keeper compensation
    /// @param outerSignature EIP712 signature for the preceeding message
    function verifyRelayedGroupCancellation(
        RelayedGroupCancellation calldata message,
        bytes calldata outerSignature
    ) external;

    /// @dev Verifies a request to relay an operator update
    /// @param message Wrapped message adding details needed for keeper compensation
    /// @param outerSignature EIP712 signature for the preceeding message
    function verifyRelayedOperatorUpdate(
        RelayedOperatorUpdate calldata message,
        bytes calldata outerSignature
    ) external;

    /// @dev Verifies a request to relay an update to designated signers
    /// @param message Wrapped message adding details needed for keeper compensation
    /// @param outerSignature EIP712 signature for the preceeding message
    function verifyRelayedSignerUpdate(
        RelayedSignerUpdate calldata message,
        bytes calldata outerSignature
    ) external;

    /// @dev Verifies a request to relay a message updating multiple operators and signers
    /// @param message Wrapped message adding details needed for keeper compensation
    /// @param outerSignature EIP712 signature for the preceeding message
    function verifyRelayedAccessUpdateBatch(
        RelayedAccessUpdateBatch calldata message,
        bytes calldata outerSignature
    ) external;
}
