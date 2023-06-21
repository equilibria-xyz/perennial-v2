// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "./IOracleProvider.sol";

interface IPythOracle is IOracleProvider {
    function initialize(bytes32 id_) external;
    function commit(uint256 versionIndex, bytes calldata updateData) external payable;
}