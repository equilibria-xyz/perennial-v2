// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { RelayedSignerUpdate } from "../types/RelayedSignerUpdate.sol";

// @notice Relays messages to downstream handlers, compensating keepers for the transaction
interface IRelayer {
    /// @notice Updates the status of a signer for the caller
    /// @param message The signer update message to relay
    /// @param outerSignature The signature of the RelayedSignerUpdate message
    /// @param innerSignature The signature of the embedded SignerUpdate message
    function relaySignerUpdate(
        RelayedSignerUpdate calldata message,
        bytes calldata outerSignature,
        bytes calldata innerSignature
    ) external;
}