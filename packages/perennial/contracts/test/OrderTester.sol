// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Fixed6 } from "@equilibria/root/number/types/Fixed6.sol";
import { Order, OrderStorageGlobal, OrderStorageLocal } from "../types/Order.sol";
import { OracleVersion } from "../types/OracleVersion.sol";
import { Position } from "../types/Position.sol";
import { MarketParameter } from "../types/MarketParameter.sol";

abstract contract OrderTester {
    function read() public virtual view returns (Order memory);

    function store(Order memory newOrder) public virtual;

    function ready(OracleVersion memory latestVersion) external view returns (bool result) {
        return read().ready(latestVersion);
    }

    function increasesPosition() external view returns (bool) {
        return read().increasesPosition();
    }

    function increasesTaker() external view returns (bool) {
        return read().increasesTaker();
    }

    function decreasesLiquidity(Position memory currentPosition) external view returns (bool) {
        return read().decreasesLiquidity(currentPosition);
    }

    function liquidityCheckApplicable(MarketParameter memory marketParameter) external view returns (bool) {
        return read().liquidityCheckApplicable(marketParameter);
    }

    function isEmpty() external view returns (bool) {
        return read().isEmpty();
    }

    function magnitude() external view returns (Fixed6) {
        return read().magnitude();
    }
}

contract OrderGlobalTester is OrderTester {
    OrderStorageGlobal public order;

    function read() public view override returns (Order memory) {
        return order.read();
    }

    function store(Order memory newOrder) public override {
        order.store(newOrder);
    }
}

contract OrderLocalTester is OrderTester {
    OrderStorageLocal public order;

    function read() public view override returns (Order memory) {
        return order.read();
    }

    function store(Order memory newOrder) public override {
        order.store(newOrder);
    }
}
