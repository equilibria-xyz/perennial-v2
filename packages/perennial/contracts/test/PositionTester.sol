// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { UFixed6 } from "@equilibria/root/number/types/UFixed6.sol";
import { Fixed6 } from "@equilibria/root/number/types/Fixed6.sol";
import { Position, PositionStorageGlobal, PositionStorageLocal } from "../types/Position.sol";
import { Order } from "../types/Order.sol";
import { RiskParameter } from "../types/RiskParameter.sol";
import { OracleVersion } from "../types/OracleVersion.sol";


abstract contract PositionTester {
    function read() public view virtual returns (Position memory);

    function store(Position memory newPosition) public virtual;

    function update(Order memory newOrder) external {
        Position memory _position = read();
        _position.update(newOrder);
        store(_position);
    }

    function magnitude() external view returns (UFixed6) {
        return read().magnitude();
    }

    function major() external view returns (UFixed6) {
        return read().major();
    }

    function minor() external view returns (UFixed6) {
        return read().minor();
    }

    function skew() external view returns (Fixed6) {
        return read().skew();
    }

    function socializedMakerPortion() external view returns (UFixed6) {
        return read().socializedMakerPortion();
    }

    function utilization(RiskParameter memory riskParameter) external view returns (UFixed6) {
        return read().utilization(riskParameter);
    }

    function longSocialized() external view returns (UFixed6) {
        return read().longSocialized();
    }

    function shortSocialized() external view returns (UFixed6) {
        return read().shortSocialized();
    }

    function takerSocialized() external view returns (UFixed6) {
        return read().takerSocialized();
    }

    function efficiency() external view returns (UFixed6) {
        return read().efficiency();
    }

    function socialized() external view returns (bool) {
        return read().socialized();
    }

    function maintenance(
        OracleVersion memory latestVersion,
        RiskParameter memory riskParameter
    ) external view returns (UFixed6) {
        return read().maintenance(latestVersion, riskParameter);
    }

    function margin(
        OracleVersion memory latestVersion,
        RiskParameter memory riskParameter
    ) external view returns (UFixed6) {
        return read().margin(latestVersion, riskParameter);
    }

    function maintained(
        OracleVersion memory currentOracleVersion,
        RiskParameter memory riskParameter,
        Fixed6 collateral
    ) external view returns (bool) {
        return read().maintained(currentOracleVersion, riskParameter, collateral);
    }

    function margined(
        OracleVersion memory currentOracleVersion,
        RiskParameter memory riskParameter,
        UFixed6 collateralization,
        Fixed6 collateral
    ) external view returns (bool) {
        return read().margined(currentOracleVersion, riskParameter, collateralization, collateral);
    }
}

contract PositionGlobalTester is PositionTester {
    PositionStorageGlobal public position;

    function read() public view override returns (Position memory) {
        return position.read();
    }

    function store(Position memory newPosition) public override {
        position.store(newPosition);
    }
}

contract PositionLocalTester is PositionTester {
    PositionStorageLocal public position;

    function read() public view override returns (Position memory) {
        return position.read();
    }

    function store(Position memory newPosition) public override {
        position.store(newPosition);
    }
}
