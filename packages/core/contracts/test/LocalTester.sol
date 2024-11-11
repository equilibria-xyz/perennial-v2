// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Fixed6 } from "@equilibria/root/number/types/Fixed6.sol";
import { Local, LocalStorage } from "../types/Local.sol";
import { CheckpointAccumulationResponse } from "../libs/CheckpointLib.sol";

contract LocalTester {
    LocalStorage public local;

    function read() external view returns (Local memory) {
        return local.read();
    }

    function store(Local memory newLocal) external {
        return local.store(newLocal);
    }

    function update(Fixed6 transfer) external {
        Local memory newLocal = local.read();
        newLocal.update(transfer);
        local.store(newLocal);
    }

    function update(
        uint256 newId,
        CheckpointAccumulationResponse memory accumulation
    ) external {
        Local memory newLocal = local.read();
        newLocal.update(newId, accumulation);
        local.store(newLocal);
    }
}
