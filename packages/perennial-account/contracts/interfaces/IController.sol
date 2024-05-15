// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { IAccount } from "../interfaces/IAccount.sol";
import { DeployAccount } from "../types/DeployAccount.sol";
import { MarketTransfer } from "../types/MarketTransfer.sol";
import { SignerUpdate } from "../types/SignerUpdate.sol";
import { Withdrawal } from "../types/Withdrawal.sol";

/// @notice Facilitates unpermissioned actions between collateral accounts and markets
interface IController {
    /// @notice Emitted when a collateral account is deployed
    /// @param user EOA for which the collateral account was created
    /// @param account contract address of the collateral account
    event AccountDeployed(address indexed user, IAccount indexed account);

    /// @notice Emitted when a delegated signer for a collateral account is assigned, enabled, or disabled
    /// @param account contract address of the collateral account
    /// @param signer identifies the signer whose status to update
    /// @param newEnabled true to assign or enable, false to disable
    event SignerUpdated(address indexed account, address indexed signer, bool newEnabled);

    // sig: 0x35e0fb4b
    /// @custom:error Signer is not authorized to interact with the specified collateral account
    error InvalidSignerError();

    /// @notice Returns the deterministic address of the collateral account for a user, 
    /// regardless of whether or not it exists.
    /// @param user Identifies the EOA for which a collateral account is desired
    function getAccountAddress(address user) external view returns (address);

    // TODO: remove this; only updating the signer may be done from a TX
    /// @notice Deploys the collateral account for msg.sender and returns the address of the account
    function deployAccount() external returns (IAccount);

    /// @notice Deploys a collateral account via a signed message 
    /// @param deployAccount Message requesting creation of a collateral account
    /// @param signature ERC712 message signature
    function deployAccountWithSignature(DeployAccount calldata deployAccount, bytes calldata signature) external;

    /// @notice Transfers tokens between a collateral account and a specified Perennial Market
    /// @param marketTransfer Message requesting a deposit to or withdrawal from the Market
    /// @param signature ERC712 message signature
    function marketTransferWithSignature(MarketTransfer calldata marketTransfer, bytes calldata signature) external;

    /// @notice Updates the status of a delegated signer for the caller's collateral account
    /// @param signer The signer to update
    /// @param newEnabled The new status of the opersignerator
    function updateSigner(address signer, bool newEnabled) external;

    /// @notice Updates the status of a delegated signer for the specified collateral account
    /// @param updateSigner Message requesting a delegation update
    /// @param signature ERC712 message signature
    function updateSignerWithSignature(SignerUpdate calldata updateSigner, bytes calldata signature) external;

    /// @notice Transfers tokens from the collateral account back to the owner of the account
    /// @param withdrawal Message requesting a withdrawal
    /// @param signature ERC712 message signature
    function withdrawWithSignature(Withdrawal calldata withdrawal, bytes calldata signature) external;
}