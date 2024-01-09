// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "../types/Delta.sol";

contract DeltaTester {
    function increasesPosition(Delta memory delta) public pure returns (bool) {
        return delta.increasesPosition();
    }

    function increasesTaker(Delta memory delta) public pure returns (bool) {
        return delta.increasesTaker();
    }

    function decreasesLiquidity(Delta memory delta, Position memory currentPosition) public pure returns (bool) {
        return delta.decreasesLiquidity(currentPosition);
    }

    function liquidityCheckApplicable(
        Delta memory delta,
        MarketParameter memory marketParameter
    ) public pure returns (bool) {
        return delta.liquidityCheckApplicable(marketParameter);
    }

    function liquidationFee(
        Delta memory delta,
        OracleVersion memory latestVersion,
        RiskParameter memory riskParameter
    ) public pure returns (UFixed6) {
        return delta.liquidationFee(latestVersion, riskParameter);
    }

    function empty(Delta memory delta) public pure returns (bool) {
        return delta.empty();
    }
}
