// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Fixed6 } from "@equilibria/root/number/types/Fixed6.sol";
import { UFixed6 } from "@equilibria/root/number/types/UFixed6.sol";
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

    function update(
        uint256 newId,
        CheckpointAccumulationResponse memory accumulation
    ) external returns(Fixed6 pnl) {
        Local memory newLocal = local.read();
        pnl = newLocal.update(newId, accumulation);
        local.store(newLocal);
    }

    function credit(UFixed6 amount) external {
        Local memory newLocal = local.read();
        newLocal.credit(amount);
        local.store(newLocal);
    }
}
