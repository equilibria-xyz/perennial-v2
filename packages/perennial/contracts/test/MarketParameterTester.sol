// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "../types/MarketParameter.sol";

contract MarketParameterTester {
    MarketParameterStorage public marketParameter;

    function read() external view returns (MarketParameter memory) {
        return marketParameter.read();
    }

    function store(MarketParameter memory newMarketParameter) external {
        return marketParameter.store(newMarketParameter);
    }
}
