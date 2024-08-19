// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "../types/Checkpoint.sol";
import "../libs/CheckpointLib.sol";

contract CheckpointTester {
    CheckpointStorage public checkpoint;

    function read() external view returns (Checkpoint memory) {
        return checkpoint.read();
    }

    function store(Checkpoint memory newCheckpoint) external {
        return checkpoint.store(newCheckpoint);
    }

    function accumulate(
        address account,
        uint256 orderId,
        Order memory order,
        Guarantee memory guarantee,
        Position memory fromPosition,
        Version memory fromVersion,
        Version memory toVersion
    ) external returns (CheckpointAccumulationResponse memory response) {
        Checkpoint memory newCheckpoint = checkpoint.read();
        (newCheckpoint, response) = CheckpointLib.accumulate(newCheckpoint, account, orderId, order, guarantee, fromPosition, fromVersion, toVersion);
        checkpoint.store(newCheckpoint);
    }
}
