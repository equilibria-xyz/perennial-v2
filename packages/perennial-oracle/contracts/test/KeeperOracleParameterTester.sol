// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { KeeperOracleParameter, KeeperOracleParameterStorage } from "../keeper/types/KeeperOracleParameter.sol";

contract KeeperOracleParameterTester {
    KeeperOracleParameterStorage public kreeperOracleParameter;

    function read() public view returns (KeeperOracleParameter memory) {
        return kreeperOracleParameter.read();
    }

    function store(KeeperOracleParameter memory newKeeperOracleParameter) public {
        return kreeperOracleParameter.store(newKeeperOracleParameter);
    }
}