// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "../types/Order.sol";

contract OrderTester {
    function ready(Order memory order, OracleVersion memory latestVersion) external pure returns (bool result) {
        return order.ready(latestVersion);
    }

    function increasesPosition(Order memory order) public pure returns (bool) {
        return order.increasesPosition();
    }

    function increasesTaker(Order memory order) public pure returns (bool) {
        return order.increasesTaker();
    }

    function decreasesLiquidity(Order memory order, Position memory currentPosition) public pure returns (bool) {
        return order.decreasesLiquidity(currentPosition);
    }

    function liquidityCheckApplicable(
        Order memory order,
        MarketParameter memory marketParameter
    ) public pure returns (bool) {
        return order.liquidityCheckApplicable(marketParameter);
    }

    function liquidationFee(
        Order memory order,
        OracleVersion memory latestVersion,
        RiskParameter memory riskParameter
    ) public pure returns (UFixed6) {
        return order.liquidationFee(latestVersion, riskParameter);
    }

    function isEmpty(Order memory order) public pure returns (bool) {
        return order.isEmpty();
    }
}
