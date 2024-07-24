// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { IVerifierBase } from "@equilibria/root/verifier/interfaces/IVerifierBase.sol";

/// @notice EIP712 signed message verifier for Perennial V2 Trigger Orders.
interface IOrderVerifier is IVerifierBase {
    /*/// @notice Verifies the signature of no-op action message
    /// @dev Cancels the nonce after verifying the signature
    ///      Reverts if the signature does not match the signer
    /// @param action Data common to all action messages
    /// @param signature EIP712 signature for the message
    function verifyAction(Action calldata action, bytes calldata signature) external;*/
}