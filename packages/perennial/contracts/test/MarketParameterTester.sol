// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "../types/MarketParameter.sol";

contract MarketParameterTester {
    MarketParameterStorage public marketParameter;

    function read() external view returns (MarketParameter memory) {
        return marketParameter.read();
    }

    function validateAndStore(
        MarketParameter memory newMarketParameter,
        ProtocolParameter memory protocolParameter,
        Token18 reward
    ) external {
        return marketParameter.validateAndStore(newMarketParameter, protocolParameter, reward);
    }
}
