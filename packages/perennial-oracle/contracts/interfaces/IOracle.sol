// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/control/interfaces/IOwnable.sol";
import "./IOracleProvider.sol";

interface IOracle is IOwnable, IOracleProvider {
    function initialize(IOracleProvider initialProvider) external;
    function update(IOracleProvider newProvider) external;
}