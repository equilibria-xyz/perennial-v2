// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "../keeper/libs/IdLib.sol";

contract IdTester {
    function unique(bytes32[] memory ids) external pure returns (uint256) {
        return IdLib.unique(ids);
    }

    function dedup(bytes32[] memory ids) external pure returns (bytes32[] memory dedupedIds, uint256[] memory indices) {
        return IdLib.dedup(ids);
    }
}