// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { OracleParameter, OracleParameterStorage } from "../types/OracleParameter.sol";

contract OracleParameterTester {
    OracleParameterStorage public oracleParameter;

    function read() public view returns (OracleParameter memory) {
        return oracleParameter.read();
    }

    function store(OracleParameter memory newOracleParameter) public {
        return oracleParameter.store(newOracleParameter);
    }
}