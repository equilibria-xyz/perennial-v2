// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "../types/Checkpoint.sol";

contract CheckpointTester {
    CheckpointStorage public checkpoint;

    function read() external view returns (Checkpoint memory) {
        return checkpoint.read();
    }

    function store(Checkpoint memory newCheckpoint) external {
        return checkpoint.store(newCheckpoint);
    }

    function accumulate(
        Order memory order,
        Position memory fromPosition,
        Version memory fromVersion,
        Version memory toVersion
    ) external returns (CheckpointAccumulationResult memory result) {
        Checkpoint memory newCheckpoint = checkpoint.read();
        result = newCheckpoint.accumulate(order, fromPosition, fromVersion, toVersion);
        checkpoint.store(newCheckpoint);
    }
}
