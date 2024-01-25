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

    function updateCollateral(
        Checkpoint memory previousCheckpoint,
        Checkpoint memory currentCheckpoint,
        Fixed6 collateral
    ) external {
        Checkpoint memory newCheckpoint = checkpoint.read();
        newCheckpoint.updateCollateral(previousCheckpoint, currentCheckpoint, collateral);
        checkpoint.store(newCheckpoint);
    }

    function updateFees(Fixed6 tradeFee, UFixed6 settlementFee) external {
        Checkpoint memory newCheckpoint = checkpoint.read();
        newCheckpoint.updateFees(tradeFee, settlementFee);
        checkpoint.store(newCheckpoint);
    }

    function updateDelta(Fixed6 collateral) external {
        Checkpoint memory newCheckpoint = checkpoint.read();
        newCheckpoint.updateDelta(collateral);
        checkpoint.store(newCheckpoint);
    }

    function next() external {
        Checkpoint memory newCheckpoint = checkpoint.read();
        newCheckpoint.next();
        checkpoint.store(newCheckpoint);
    }
}
