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

    function initialize(Account memory global, UFixed18 balance) external {
        Checkpoint memory newCheckpoint = checkpoint.read();

        newCheckpoint.initialize(global, balance);

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

    function complete(
        Fixed6 assets,
        UFixed6 fee,
        UFixed6 keeper
    ) external {
        Checkpoint memory newCheckpoint = checkpoint.read();

        newCheckpoint.complete(assets, fee, keeper);

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

    function toShares(UFixed6 assets, UFixed6 keeper) external view returns (UFixed6) {
        return checkpoint.read().toShares(assets, keeper);
    }

    function toAssetes(UFixed6 shares, UFixed6 keeper) external view returns (UFixed6) {
        return checkpoint.read().toAssets(shares, keeper);
    }

    function unhealthy() external view returns (bool) {
        return checkpoint.read().unhealthy();
    }
}
