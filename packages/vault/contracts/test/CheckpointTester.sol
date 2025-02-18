// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { UFixed6 } from "@equilibria/root/number/types/UFixed6.sol";
import { UFixed18 } from "@equilibria/root/number/types/UFixed18.sol";
import { Checkpoint as PerennialCheckpoint } from "@perennial/v2-core/contracts/types/Checkpoint.sol";
import { Checkpoint, CheckpointStorage } from "../types/Checkpoint.sol";
import { Account } from "../types/Account.sol";
import { VaultParameter } from "../types/VaultParameter.sol";

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

    function complete(
        UFixed18 mark,
        VaultParameter memory parameter,
        PerennialCheckpoint memory marketCheckpoint
    ) external returns (UFixed18 newMark, UFixed6 profitShare) {
        Checkpoint memory newCheckpoint = checkpoint.read();

        (newMark, profitShare) = newCheckpoint.complete(mark, parameter, marketCheckpoint);

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

    function toAssets(UFixed6 shares) external view returns (UFixed6) {
        return checkpoint.read().toAssets(shares);
    }

    function unhealthy() external view returns (bool) {
        return checkpoint.read().unhealthy();
    }
}
