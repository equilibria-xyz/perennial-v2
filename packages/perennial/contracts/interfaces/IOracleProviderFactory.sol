// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { IOracleProvider } from "./IOracleProvider.sol";

interface IOracleProviderFactory {
    event OracleCreated(IOracleProvider indexed oracle, bytes32 indexed id);

    function oracles(bytes32 id) external view returns (IOracleProvider);
    function ids(IOracleProvider oracleProvider) external view returns (bytes32 id);
}