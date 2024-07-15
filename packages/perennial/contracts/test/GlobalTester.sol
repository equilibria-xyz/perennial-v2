// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "../types/Global.sol";

contract GlobalTester {
    GlobalStorage public global;

    function read() external view returns (Global memory) {
        return global.read();
    }

    function store(Global memory newGlobal) external {
        return global.store(newGlobal);
    }

    function update(
        uint256 newLatestId,
        VersionAccumulationResult memory accumulation,
        MarketParameter memory marketParameter,
        ProtocolParameter memory protocolParameter,
        OracleReceipt memory oracleReceipt
    ) external {
        Global memory newGlobal = global.read();
        newGlobal.update(newLatestId, accumulation, marketParameter, protocolParameter, oracleReceipt);
        global.store(newGlobal);
    }
}
