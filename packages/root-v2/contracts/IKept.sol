// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { AggregatorV3Interface } from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "@equilibria/root/control/interfaces/IInitializable.sol";
import "@equilibria/root/number/types/UFixed18.sol";
import "@equilibria/root/token/types/Token18.sol";

interface IKept is IInitializable {
    event KeeperCall(address indexed sender, uint256 gasUsed, UFixed18 multiplier, uint256 buffer, UFixed18 keeperFee);

    function ethUsdOracleFeed() external view returns (AggregatorV3Interface);
    function keeperToken() external view returns (Token18);
}
