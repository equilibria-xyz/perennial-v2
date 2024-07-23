// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { IVerifierBase } from "@equilibria/root/verifier/interfaces/IVerifierBase.sol";
import { IRelayVerifier } from "./IRelayVerifier.sol";
import { Action } from "../types/Action.sol";
import { DeployAccount } from "../types/DeployAccount.sol";
import { MarketTransfer } from "../types/MarketTransfer.sol";
import { RebalanceConfigChange } from "../types/RebalanceConfigChange.sol";
import { Withdrawal } from "../types/Withdrawal.sol";

/// @notice EIP712 signed message verifier for Perennial V2 Collateral Accounts.
interface IAccountVerifier is IVerifierBase, IRelayVerifier {
    /// @notice Verifies the signature of no-op action message
    /// @dev Cancels the nonce after verifying the signature
    ///      Reverts if the signature does not match the signer
    /// @param action Data common to all action messages
    /// @param signature EIP712 signature for the message
    function verifyAction(Action calldata action, bytes calldata signature) external;

    /// @notice Verifies the signature of a request to deploy a collateral account
    /// @dev Cancels the nonce after verifying the signature
    ///      Reverts if the signature does not match the signer
    /// @param deployAccount message to verify, which includes the owner of the collateral account
    /// @param signature EIP712 signature for the message
    function verifyDeployAccount(DeployAccount calldata deployAccount, bytes calldata signature) external;

    /// @notice Verifies the signature of a request to transfer funds between a collateral account and a market
    /// @dev Cancels the nonce after verifying the signature
    ///      Reverts if the signature does not match the signer
    /// @param transfer message to verify
    /// @param signature EIP712 signature for the message
    function verifyMarketTransfer(MarketTransfer calldata transfer, bytes calldata signature) external;

    /// @notice Verifies the signature of a request to change rebalancing configuration for multiple markets
    /// @dev Cancels the nonce after verifying the signature
    /// @param change message to verify
    /// @param signature EIP712 signature for the message
    function verifyRebalanceConfigChange(RebalanceConfigChange calldata change, bytes calldata signature) external;

    /// @notice Verifies the signature of a request to transfer funds from the collateral account back to the owner
    /// @dev Cancels the nonce after verifying the signature
    ///      Reverts if the signature does not match the signer
    /// @param withdrawal message to verify, which includes the owner of the collateral account
    /// @param signature EIP712 signature for the message
    function verifyWithdrawal(Withdrawal calldata withdrawal, bytes calldata signature) external;
}
