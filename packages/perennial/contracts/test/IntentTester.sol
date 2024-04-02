// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "../types/Intent.sol";

abstract contract IntentTester {
    function read() public virtual view returns (Intent memory);

    function store(Intent memory newIntent) public virtual;

    function from(Order memory order, Fixed6 price) external {
        Intent memory newIntent = IntentLib.from(order, price);
        store(newIntent);
    }
}

contract IntentGlobalTester is IntentTester {
    IntentStorageGlobal public intent;

    function read() public view override returns (Intent memory) {
        return intent.read();
    }

    function store(Intent memory newIntent) public override {
        intent.store(newIntent);
    }
}

contract IntentLocalTester is IntentTester {
    IntentStorageLocal public intent;

    function read() public view override returns (Intent memory) {
        return intent.read();
    }

    function store(Intent memory newIntent) public override {
        intent.store(newIntent);
    }
}
