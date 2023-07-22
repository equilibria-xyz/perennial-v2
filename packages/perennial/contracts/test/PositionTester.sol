// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "../types/Position.sol";

abstract contract PositionTester {
    function read() public view virtual returns (Position memory);

    function store(Position memory newPosition) public virtual;

    function ready(OracleVersion memory latestVersion) external view returns (bool result) {
        return read().ready(latestVersion);
    }

    function update(Position memory newPosition) external {
        Position memory _position = read();
        _position.update(newPosition);
        store(_position);
    }

    function update(
        uint256 currentTimestamp,
        UFixed6 newMaker,
        UFixed6 newLong,
        UFixed6 newShort
    ) external returns (Order memory newOrder) {
        Position memory _position = read();
        newOrder = _position.update(currentTimestamp, newMaker, newLong, newShort);
        store(_position);
    }

    function update(
        uint256 currentTimestamp,
        Order memory order,
        RiskParameter memory riskParameter
    ) external returns (Order memory updatedOrder) {
        Position memory _position = read();
        _position.update(currentTimestamp, order, riskParameter);
        store(_position);
        return order;
    }

    function update(Fixed6 collateralAmount) external {
        Position memory _position = read();
        _position.update(collateralAmount);
        store(_position);
    }

    function prepare() external {
        Position memory _position = read();
        _position.prepare();
        store(_position);
    }

    function invalidate(Position memory latestPosition) external {
        Position memory _position = read();
        _position.invalidate(latestPosition);
        store(_position);
    }

    function sync(OracleVersion memory latestVersion) external {
        Position memory _position = read();
        _position.sync(latestVersion);
        store(_position);
    }

    function registerFee(Order memory order) external {
        Position memory _position = read();
        _position.registerFee(order);
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

    function net() external view returns (UFixed6) {
        return read().net();
    }

    function skew() external view returns (Fixed6) {
        return read().skew();
    }

    function virtualSkew(RiskParameter memory riskParameter) external view returns (Fixed6) {
        return read().virtualSkew(riskParameter);
    }

    function utilization() external view returns (UFixed6) {
        return read().utilization();
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

    function singleSided() external view returns (bool) {
        return read().singleSided();
    }

    function maintenance(
        OracleVersion memory latestVersion,
        RiskParameter memory riskParameter
    ) external view returns (UFixed6) {
        return read().maintenance(latestVersion, riskParameter);
    }

    function collateralized(
        OracleVersion memory currentOracleVersion,
        RiskParameter memory riskParameter,
        Fixed6 collateral
    ) external view returns (bool) {
        return read().collateralized(currentOracleVersion, riskParameter, collateral);
    }

    function liquidationFee(
        OracleVersion memory currentOracleVersion,
        RiskParameter memory riskParameter
    ) external view returns (UFixed6) {
        return read().liquidationFee(currentOracleVersion, riskParameter);
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
