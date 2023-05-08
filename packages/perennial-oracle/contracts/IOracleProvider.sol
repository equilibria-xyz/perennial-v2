// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "./types/OracleVersion.sol";

/// @dev OracleVersion Invariants
///       - Each new issued version must be increasing, but does not need to incrementing (may have gaps)
///       - Versions are allowed to "fail" and will be marked as .valid = false
///       - Versions must be committed in order, i.e. all issued versions prior to latestVersion must be available
///       - The latest version will always be a "valid" version, invalid versions will not update latest
interface IOracleProvider {
    function sync() external returns (OracleVersion memory, uint256);
    function latest() external view returns (OracleVersion memory);
    function current() external view returns (uint256);
    function at(uint256 version) external view returns (OracleVersion memory);
}