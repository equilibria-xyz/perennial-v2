// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { OracleVersion } from "@equilibria/perennial-v2/contracts/types/OracleVersion.sol";
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

    function canExecute(TriggerOrder calldata order_, OracleVersion calldata version_) external pure returns (bool) {
        return order_.canExecute(version_);
    }
}