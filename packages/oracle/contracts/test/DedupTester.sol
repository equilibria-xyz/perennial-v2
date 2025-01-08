// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { DedupLib } from "../keeper/libs/DedupLib.sol";

contract DedupTester {
    function dedup(bytes32[] memory ids) external pure returns (bytes32[] memory dedupedIds, uint256[] memory indices) {
        return DedupLib.dedup(ids);
    }
}