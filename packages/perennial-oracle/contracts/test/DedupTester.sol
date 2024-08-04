// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "../keeper/libs/DedupLib.sol";

contract DedupTester {
    function unique(bytes32[] memory ids) external pure returns (uint256) {
        return DedupLib.unique(ids);
    }

    function dedup(bytes32[] memory ids) external pure returns (bytes32[] memory dedupedIds, uint256[] memory indices) {
        return DedupLib.dedup(ids);
    }
}