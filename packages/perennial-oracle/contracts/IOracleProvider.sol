// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "./types/OracleVersion.sol";

interface IOracleProvider {
    function sync() external returns (OracleVersion memory, uint256);
    function latest() external view returns (OracleVersion memory);
    function current() external view returns (uint256);
    function at(uint256 version) external view returns (OracleVersion memory);
}