// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "../types/Local.sol";

contract LocalTester {
    LocalStorage public local;

    function read() external view returns (Local memory) {
        return local.read();
    }

    function store(Local memory newLocal) external {
        return local.store(newLocal);
    }

    function update(Fixed6 collateral) external {
        Local memory newLocal = local.read();
        newLocal.update(collateral);
        local.store(newLocal);
    }

    function accumulate(
        uint256 latestId,
        Position memory fromPosition,
        Position memory toPosition,
        Version memory fromVersion,
        Version memory toVersion
    ) external returns (LocalAccumulationResult memory values) {
        Local memory newLocal = local.read();
        values = newLocal.accumulate(latestId, fromPosition, toPosition, fromVersion, toVersion);
        local.store(newLocal);
    }

    function protect(
        Position memory latestPosition,
        uint256 currentTimestamp,
        bool tryProtect
    ) external returns (bool protection) {
        Local memory newLocal = local.read();
        protection = newLocal.protect(latestPosition, currentTimestamp, tryProtect);
        local.store(newLocal);
    }
}
