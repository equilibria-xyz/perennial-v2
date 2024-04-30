// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { DeployAccount, DeployAccountLib } from "../types/DeployAccount.sol";

interface IController {
    /// @notice Deploys and returns the collateral account for msg.sender
    function deployAccount() external;

    /// @notice Deploys a collateral account via a signed message 
    /// @param deployAccount Message requesting creation of a collateral account
    /// @param signature ERC712 message signature
    function deployAccountWithSignature(DeployAccount calldata deployAccount, bytes calldata signature) external;

    /// @notice Returns the deterministic address of the collateral account for a user, 
    /// regardless of whether or not it exists.
    /// @param user Identifies the EOA for which a collateral account is desired
    function getAccount(address user) external returns (address);
}