// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "../types/Intent.sol";

abstract contract IntentOrderTester {
    function read() public virtual view returns (Intent memory);

    function store(IntentOrder memory newIntent) public virtual;

    function from(Order memory order, Fixed6 price, bool settlementFee) external {
        IntentOrder memory newIntentOrder = IntentOrderLib.from(order, price, settlementFee);
        store(newIntentOrder);
    }
}

contract IntentOrderGlobalTester is IntentOrderTester {
    IntentOrderStorageGlobal public intentOrder;

    function read() public view override returns (IntentOrder memory) {
        return intentOrder.read();
    }

    function store(IntentOrder memory newIntentOrder) public override {
        intentOrder.store(newIntentOrder);
    }
}

contract IntentOrderLocalTester is IntentOrderTester {
    IntentOrderStorageLocal public intentOrder;

    function read() public view override returns (IntentOrder memory) {
        return intentOrder.read();
    }

    function store(IntentOrder memory newIntentOrder) public override {
        intentOrder.store(newIntentOrder);
    }
}
