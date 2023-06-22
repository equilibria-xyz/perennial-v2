// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "../types/OracleVersion.sol";
import "./IOracleProvider.sol";

// TODO: this is acting kind of like IOracleProvider, but also kind of like IOracle
interface IOracleFactory {
    event OracleCreated(IOracleProvider indexed oracle, bytes32 indexed id);

    function ids(IOracleProvider oracle) external view returns (bytes32 id);
    function oracles(bytes32 id) external view returns (IOracleProvider);
}