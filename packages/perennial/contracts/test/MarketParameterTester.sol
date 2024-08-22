// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { MarketParameter, MarketParameterStorage } from "../types/MarketParameter.sol";
import { ProtocolParameter } from "../types/ProtocolParameter.sol";

contract MarketParameterTester {
    MarketParameterStorage public marketParameter;

    function read() external view returns (MarketParameter memory) {
        return marketParameter.read();
    }

    function validateAndStore(
        MarketParameter memory newMarketParameter,
        ProtocolParameter memory protocolParameter
    ) external {
        return marketParameter.validateAndStore(newMarketParameter, protocolParameter);
    }
}
