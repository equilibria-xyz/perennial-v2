// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "../types/Checkpoint.sol";

contract CheckpointTester {
    CheckpointStorage public checkpoint;

    function store(Checkpoint memory newCheckpoint) external {
        checkpoint.store(newCheckpoint);
    }

    function read() external view returns (Checkpoint memory) {
        return checkpoint.read();
    }

    function next(uint256 timestamp, Account memory global) external {
        Checkpoint memory newCheckpoint = checkpoint.read();

        newCheckpoint.next(timestamp, global);

        checkpoint.store(newCheckpoint);
    }

    function update(
        UFixed6 deposit,
        UFixed6 redemption
    ) external {
        Checkpoint memory newCheckpoint = checkpoint.read();

        newCheckpoint.update(deposit, redemption);

        checkpoint.store(newCheckpoint);
    }

    function complete(PerennialCheckpoint memory marketCheckpoint) external {
        Checkpoint memory newCheckpoint = checkpoint.read();

        newCheckpoint.complete(marketCheckpoint);

        checkpoint.store(newCheckpoint);
    }

    function toSharesGlobal(UFixed6 assets) external view returns (UFixed6) {
        return checkpoint.read().toSharesGlobal(assets);
    }

    function toAssetsGlobal(UFixed6 shares) external view returns (UFixed6) {
        return checkpoint.read().toAssetsGlobal(shares);
    }

    function toSharesLocal(UFixed6 assets) external view returns (UFixed6) {
        return checkpoint.read().toSharesLocal(assets);
    }

    function toAssetsLocal(UFixed6 shares) external view returns (UFixed6) {
        return checkpoint.read().toAssetsLocal(shares);
    }

    function toShares(UFixed6 assets, UFixed6 settlementFee) external view returns (UFixed6) {
        return checkpoint.read().toShares(assets, settlementFee);
    }

    function toAssetes(UFixed6 shares, UFixed6 settlementFee) external view returns (UFixed6) {
        return checkpoint.read().toAssets(shares, settlementFee);
    }

    function unhealthy() external view returns (bool) {
        return checkpoint.read().unhealthy();
    }
}
