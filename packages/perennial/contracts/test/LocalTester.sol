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

    function processProtection(
        Position memory latestPosition,
        Version memory version
    ) external returns (bool result) {
        Local memory newLocal = local.read();
        result = newLocal.processProtection(latestPosition, version);
        local.store(newLocal);
    }

    function processLiquidationFee(Local memory initiateeLocal) external {
        Local memory newLocal = local.read();
        newLocal.processLiquidationFee(initiateeLocal);
        local.store(newLocal);
    }

    function protect(
        RiskParameter memory riskParameter,
        OracleVersion memory latestVersion,
        uint256 currentTimestamp,
        Order memory newOrder,
        address initiator,
        bool tryProtect
    ) external returns (bool result) {
        Local memory newLocal = local.read();
        result = newLocal.protect(riskParameter, latestVersion, currentTimestamp, newOrder, initiator, tryProtect);
        local.store(newLocal);
    }

    function pendingLiquidationFee(Position memory latestPosition) external view returns (UFixed6) {
        return local.read().pendingLiquidationFee(latestPosition);
    }
}
