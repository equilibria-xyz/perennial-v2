// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { RiskParameter, RiskParameterStorage } from "../types/RiskParameter.sol";
import { ProtocolParameter } from "../types/ProtocolParameter.sol";

contract RiskParameterTester {
    RiskParameterStorage public riskParameter;

    function read() external view returns (RiskParameter memory) {
        return riskParameter.read();
    }

    function validateAndStore(RiskParameter memory newRiskParameter, ProtocolParameter memory protocolParameter) external {
        return riskParameter.validateAndStore(newRiskParameter, protocolParameter);
    }
}
