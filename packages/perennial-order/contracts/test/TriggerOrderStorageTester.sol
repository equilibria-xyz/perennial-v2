// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { TriggerOrder, TriggerOrderStorage, TriggerOrderStorageLib } from "../types/TriggerOrder.sol";

contract TriggerOrderStorageTester {
    TriggerOrderStorage public order;

    function read() external view returns (TriggerOrder memory) {
        return order.read();
    }

    function store(TriggerOrder memory newOrder) external {
        order.store(newOrder);
    }
}