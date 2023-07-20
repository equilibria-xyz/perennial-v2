// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "../types/RiskParameter.sol";

contract RiskParameterTester {
    RiskParameterStorage public riskParameter;

    function read() external view returns (RiskParameter memory) {
        return riskParameter.read();
    }

    function store(RiskParameter memory newRiskParameter) external {
        return riskParameter.store(newRiskParameter);
    }

    function validate(ProtocolParameter memory protocolParameter) public view {
        riskParameter.read().validate(protocolParameter);
    }
}
