// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { IVerifierBase } from "@equilibria/root/verifier/interfaces/IVerifierBase.sol";
// import { Common } from "@equilibria/root/verifier/types/Common.sol";
import { Action } from "../types/Action.sol";
import { DeployAccount } from "../types/DeployAccount.sol";

interface IVerifier is IVerifierBase {
    /// @notice Verifies the signature of no-op action message
    /// @dev Cancels the nonce after verifying the signature
    /// @param action Data common to all action messages
    /// @param signature The signature of the account for the message
    /// @return The address corresponding to the signature
    function verifyAction(Action calldata action, bytes calldata signature) external returns (address);

    /// @notice Verifies the signature of a request to deploy a collateral account
    /// @dev Cancels the nonce after verifying the signature
    /// @param deployAccount identifies the EOA of the user and signer
    /// @return The address corresponding to the signature
    function verifyDeployAccount(DeployAccount calldata deployAccount, bytes calldata signature) external returns (address);
}