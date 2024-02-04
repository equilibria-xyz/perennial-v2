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

    function update(
        Order memory order,
        Fixed6 collateral,
        Fixed6 tradeFee,
        UFixed6 settlementFee
    ) external {
        Checkpoint memory newCheckpoint = checkpoint.read();
        newCheckpoint.update(order, collateral, tradeFee, settlementFee);
        checkpoint.store(newCheckpoint);
    }
}
