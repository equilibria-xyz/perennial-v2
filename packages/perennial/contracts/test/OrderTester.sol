// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "../types/Order.sol";

contract OrderTester {
    function registerFee(
        Order memory order,
        OracleVersion memory latestVersion,
        MarketParameter memory marketParameter,
        RiskParameter memory riskParameter
    ) public pure returns (Order memory) {
        order.registerFee(latestVersion, marketParameter, riskParameter);

        return order;
    }

    function increasesPosition(Order memory order) public pure returns (bool) {
        return order.increasesPosition();
    }

    function increasesTaker(Order memory order) public pure returns (bool) {
        return order.increasesTaker();
    }

    function liquidityCheckApplicable(
        Order memory order,
        MarketParameter memory marketParameter
    ) public pure returns (bool) {
        return order.liquidityCheckApplicable(marketParameter);
    }

    function isEmpty(Order memory order) public pure returns (bool) {
        return order.isEmpty();
    }
}
