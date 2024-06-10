// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { IVerifierBase } from "@equilibria/root/verifier/interfaces/IVerifierBase.sol";
import { Action } from "../types/Action.sol";
import { DeployAccount } from "../types/DeployAccount.sol";
import { SignerUpdate } from "../types/SignerUpdate.sol";
import { Withdrawal } from "../types/Withdrawal.sol";

/// @notice ERC712 signed message verifier for the Perennial V2 Collateral Accounts package.
interface IVerifier is IVerifierBase {
    /// @notice Verifies the signature of no-op action message
    /// @dev Cancels the nonce after verifying the signature
    ///      Reverts if the signature does not match the signer
    /// @param action Data common to all action messages
    /// @param signature The signature of the account for the message
    function verifyAction(Action calldata action, bytes calldata signature) external;

    /// @notice Verifies the signature of a request to deploy a collateral account
    /// @dev Cancels the nonce after verifying the signature
    ///      Reverts if the signature does not match the signer
    /// @param deployAccount message to verify, which includes the owner of the collateral account
    function verifyDeployAccount(DeployAccount calldata deployAccount, bytes calldata signature) external;

    /// @notice Verifies the signature of a request to assign/enable/disable a delegated signer for the sender's collateral account
    /// @dev Cancels the nonce after verifying the signature
    ///      Reverts if the signature does not match the signer
    /// @param signerUpdate message to verify, which includes the owner of the collateral account
    function verifySignerUpdate(SignerUpdate calldata signerUpdate, bytes calldata signature) external;

    /// @notice Verifies the signature of a request to transfer funds from the collateral account back to the owner
    /// @dev Cancels the nonce after verifying the signature
    ///      Reverts if the signature does not match the signer
    /// @param withdrawal message to verify, which includes the owner of the collateral account
    function verifyWithdrawal(Withdrawal calldata withdrawal, bytes calldata signature) external;
}
