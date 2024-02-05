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

    function incrementFees(
        UFixed6 amount,
        UFixed6 settlementFee,
        MarketParameter memory marketParameter,
        ProtocolParameter memory protocolParameter
    ) external {
        Global memory newGlobal = global.read();
        newGlobal.incrementFees(amount, settlementFee, marketParameter, protocolParameter);
        global.store(newGlobal);
    }
}
