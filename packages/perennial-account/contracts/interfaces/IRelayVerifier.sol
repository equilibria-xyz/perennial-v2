// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { IVerifierBase } from "@equilibria/root/verifier/interfaces/IVerifierBase.sol";
import { RelayedNonceCancellation } from "../types/RelayedNonceCancellation.sol";
import { RelayedGroupCancellation } from "../types/RelayedGroupCancellation.sol";
import { RelayedSignerUpdate } from "../types/RelayedSignerUpdate.sol";

/// @notice EIP712 signed message verifier for relaying messages through Collateral Accounts Controller.
interface IRelayVerifier is IVerifierBase {
    function verifyRelayedNonceCancellation(
        RelayedNonceCancellation calldata message,
        bytes calldata outerSignature
    ) external;

    function verifyRelayedGroupCancellation(
        RelayedGroupCancellation calldata message,
        bytes calldata outerSignature
    ) external;

    /// @notice Updates designated signers protocol-wide
    /// @dev relays messages to the MarketFactory
    /// @param message Wrapped message adding details needed for keeper compensation
    /// @param outerSignature EIP712 signature for the preceeding message
    function verifyRelayedSignerUpdate(
        RelayedSignerUpdate calldata message,
        bytes calldata outerSignature
    ) external;
}