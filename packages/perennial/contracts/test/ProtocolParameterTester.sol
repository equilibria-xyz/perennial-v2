// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "../types/ProtocolParameter.sol";

contract ProtocolParameterTester {
    ProtocolParameterStorage public protocolParameter;

    function read() external view returns (ProtocolParameter memory) {
        return protocolParameter.read();
    }

    function store(ProtocolParameter memory newProtocolParameter) external {
        return protocolParameter.store(newProtocolParameter);
    }
}
