// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { IMarket, OracleVersion } from "@perennial/v2-core/contracts/interfaces/IMarket.sol";
import {
    TriggerOrder,
    TriggerOrderLib,
    TriggerOrderStorage,
    TriggerOrderStorageLib
} from "../types/TriggerOrder.sol";

contract TriggerOrderTester {
    TriggerOrderStorage public order;

    function read() external view returns (TriggerOrder memory) {
        return order.read();
    }

    function store(TriggerOrder memory newOrder) external {
        order.store(newOrder);
    }

    function canExecute(TriggerOrder calldata order_, OracleVersion calldata version) external pure returns (bool) {
        return order_.canExecute(version);
    }

    function notionalValue(TriggerOrder calldata order_, IMarket market, address user) external view returns (UFixed6) {
        return order_.notionalValue(market, user);
    }
}
