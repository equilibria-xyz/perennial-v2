// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "./types/OracleVersion.sol";

/// @dev OracleVersion Invariants
///       - Each newly issued version must be increasing, but does not need to incrementing
///         - We recommend using something like timestamps or blocks for versions so that intermediary non-requested
///           versions may be posted for the purpose of expedient liquidations
///       - Versions are allowed to "fail" and will be marked as .valid = false
///       - Versions must be committed in order, i.e. all issued versions prior to latestVersion must be available
///       - The latest version will always be a "valid" version, invalid versions will not update latest
///       - Non-requested versions may be committed, but will not receive a keeper reward
///         - This is useful for immediately liquidating an account with a valid off-chain price in between orders
///         - Satisfying the above constraints, only versions more recent than the latest version may be committed
interface IOracleProvider {
    function sync() external returns (OracleVersion memory, uint256);
    function latest() external view returns (OracleVersion memory);
    function current() external view returns (uint256);
    function at(uint256 version) external view returns (OracleVersion memory);
}