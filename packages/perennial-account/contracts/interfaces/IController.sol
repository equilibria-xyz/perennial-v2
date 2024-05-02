// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { DeployAccount, DeployAccountLib } from "../types/DeployAccount.sol";

/// @notice Facilitates unpermissioned actions between collateral accounts and markets
interface IController {
    /// @notice Emitted when a collateral account is deployed
    /// @param user EOA for which the collateral account was created
    /// @param account contract address of the collateral account
    event AccountDeployed(address indexed user, address indexed account);

    // sig: 0x35e0fb4b
    /// @custom:error Signer is trying to perform an action for another user
    error InvalidSignerError();

    // TODO: remove this; only updating the signer may be done from a TX
    /// @notice Deploys the collateral account for msg.sender and returns the address of the account
    function deployAccount() external returns (address);

    /// @notice Deploys a collateral account via a signed message 
    /// @param deployAccount Message requesting creation of a collateral account
    /// @param signature ERC712 message signature
    function deployAccountWithSignature(DeployAccount calldata deployAccount, bytes calldata signature) external;

    /// @notice Returns the deterministic address of the collateral account for a user, 
    /// regardless of whether or not it exists.
    /// @param user Identifies the EOA for which a collateral account is desired
    function getAccountAddress(address user) external view returns (address);
}