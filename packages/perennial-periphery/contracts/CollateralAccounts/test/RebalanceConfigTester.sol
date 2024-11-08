// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { RebalanceConfig, RebalanceConfigStorage } from "../types/RebalanceConfig.sol";

contract RebalanceConfigTester {
    RebalanceConfigStorage public rebalanceConfig;

    function read() external view returns (RebalanceConfig memory) {
        return rebalanceConfig.read();
    }

    function store(RebalanceConfig memory newValue) external {
        return rebalanceConfig.store(newValue);
    }
}