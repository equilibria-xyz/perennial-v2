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

    function update(Fixed6 transfer) external {
        Local memory newLocal = local.read();
        newLocal.update(transfer);
        local.store(newLocal);
    }

    function update(
        uint256 newId,
        Fixed6 collateral,
        Fixed6 tradeFee,
        UFixed6 settlementFee
    ) external {
        Local memory newLocal = local.read();
        newLocal.update(newId, collateral, tradeFee, settlementFee);
        local.store(newLocal);
    }

    function processProtection(Order memory order, Version memory version) external returns (bool result) {
        Local memory newLocal = local.read();
        result = newLocal.processProtection(order, version);
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
