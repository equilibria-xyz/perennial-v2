// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { RelayedTake } from "../types/RelayedTake.sol";
import { RelayedNonceCancellation } from "../types/RelayedNonceCancellation.sol";
import { RelayedGroupCancellation } from "../types/RelayedGroupCancellation.sol";
import { RelayedOperatorUpdate } from "../types/RelayedOperatorUpdate.sol";
import { RelayedSignerUpdate } from "../types/RelayedSignerUpdate.sol";
import { RelayedAccessUpdateBatch } from "../types/RelayedAccessUpdateBatch.sol";

// @notice Relays messages to downstream handlers, compensating keepers for the transaction
interface IRelayer {
    /// @notice Relays a message to a Market to update a taker position
    /// @param message Request with details needed for keeper compensation
    /// @param outerSignature Signature of the RelayedTake message
    /// @param innerSignature Signature of the embedded Take message, signed by the solver
    function relayTake(
        RelayedTake calldata message,
        bytes calldata outerSignature,
        bytes calldata innerSignature
    ) external;

    /// @notice Relays a message to Verifier extension to invalidate a nonce
    /// @param message Request with details needed for keeper compensation
    /// @param outerSignature Signature of the RelayedNonceCancellation message
    /// @param innerSignature Signature of the embedded Common message
    function relayNonceCancellation(
        RelayedNonceCancellation calldata message,
        bytes calldata outerSignature,
        bytes calldata innerSignature
    ) external;

    /// @notice Relays a message to Verifier extension to invalidate a group nonce
    /// @param message Request with details needed for keeper compensation
    /// @param outerSignature Signature of the RelayedGroupCancellation message
    /// @param innerSignature Signature of the embedded GroupCancellation message
    function relayGroupCancellation(
        RelayedGroupCancellation calldata message,
        bytes calldata outerSignature,
        bytes calldata innerSignature
    ) external;

    /// @notice Relays a message to MarketFactory to update status of an operator
    /// @param message Request with details needed for keeper compensation
    /// @param outerSignature Signature of the RelayedOperatorUpdate message
    /// @param innerSignature Signature of the embedded OperatorUpdate message
    function relayOperatorUpdate(
        RelayedOperatorUpdate calldata message,
        bytes calldata outerSignature,
        bytes calldata innerSignature
    ) external;

    /// @notice Relays a message to MarketFactory to update status of a delegated signer
    /// @param message Request with details needed for keeper compensation
    /// @param outerSignature Signature of the RelayedSignerUpdate message
    /// @param innerSignature Signature of the embedded SignerUpdate message
    function relaySignerUpdate(
        RelayedSignerUpdate calldata message,
        bytes calldata outerSignature,
        bytes calldata innerSignature
    ) external;

    /// @notice Relays a message to MarketFactory to update multiple operators and signers
    /// @param message Request with details needed for keeper compensation
    /// @param outerSignature Signature of the RelayedAccessUpdateBatch message
    /// @param innerSignature Signature of the embedded AccessUpdateBatch message
    function relayAccessUpdateBatch(
        RelayedAccessUpdateBatch calldata message,
        bytes calldata outerSignature,
        bytes calldata innerSignature
    ) external;
}
