pragma solidity ^0.8.0;

import "../types/TriggerOrder.sol";

contract TriggerOrderTester {
    using TriggerOrderLib for TriggerOrder;
    using TriggerOrderStorageLib for TriggerOrderStorage;

    TriggerOrderStorage order;

    function storeTriggerOrder(TriggerOrder memory newOrder) public {
        order.store(newOrder);
    }

    function readTriggerOrder() public view returns (TriggerOrder memory) {
        return order.read();
    }
}