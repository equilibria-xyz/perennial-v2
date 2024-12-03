// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Global, GlobalStorage } from "../types/Global.sol";
import { VersionAccumulationResponse } from "../libs/VersionLib.sol";
import { MarketParameter } from "../types/MarketParameter.sol";
import { OracleReceipt } from "../types/OracleReceipt.sol";

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
        VersionAccumulationResponse memory accumulation,
        MarketParameter memory marketParameter,
        OracleReceipt memory oracleReceipt
    ) external {
        Global memory newGlobal = global.read();
        newGlobal.update(newLatestId, accumulation, marketParameter, oracleReceipt);
        global.store(newGlobal);
    }
}
