// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { IVerifierBase } from "@equilibria/root/verifier/interfaces/IVerifierBase.sol";
import { Action } from "../types/Action.sol";
import { CancelOrderAction } from "../types/CancelOrderAction.sol";
import { PlaceOrderAction } from "../types/PlaceOrderAction.sol";

/// @notice EIP712 signed message verifier for Perennial V2 Trigger Orders.
interface IOrderVerifier is IVerifierBase {
    /// @notice Verifies the signature of no-op action message
    /// @dev Cancels the nonce after verifying the signature
    ///      Reverts if the signature does not match the signer
    /// @param action Data common to all action messages
    /// @param signature EIP712 signature for the message
    function verifyAction(Action calldata action, bytes calldata signature) external;

    /// @notice Verifies the signature of a request to persist a new trigger order
    /// @dev Cancels the nonce after verifying the signature
    ///      Reverts if the signature does not match the signer
    /// @param action Order submission request
    /// @param signature EIP712 signature for the message
    function verifyPlaceOrder(PlaceOrderAction calldata action, bytes calldata signature) external;

    /// @notice Verifies the signature of a request to cancel an already-persisted trigger order
    /// @dev Cancels the nonce after verifying the signature
    ///      Reverts if the signature does not match the signer
    /// @param action Order cancellation request
    /// @param signature EIP712 signature for the message
    function verifyCancelOrder(CancelOrderAction calldata action, bytes calldata signature) external;
}
