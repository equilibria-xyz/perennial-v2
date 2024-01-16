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

    function accumulatePnl(
        uint256 latestId,
        Position memory fromPosition,
        Version memory fromVersion,
        Version memory toVersion
    ) external returns (Fixed6 collateralAmount) {
        Local memory newLocal = local.read();
        collateralAmount = newLocal.accumulatePnl(latestId, fromPosition, fromVersion, toVersion);
        local.store(newLocal);
    }

    function accumulateFees(
        Position memory fromPosition,
        Position memory toPosition,
        Version memory toVersion
    ) external returns (Fixed6 positionFee, UFixed6 settlementFee) {
        Local memory newLocal = local.read();
        (positionFee, settlementFee) = newLocal.accumulateFees(fromPosition, toPosition, toVersion);
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
}
