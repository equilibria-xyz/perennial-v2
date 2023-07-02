// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root-v2/contracts/IInstance.sol";
import "./IOracleProvider.sol";

interface IOracle is IOracleProvider, IInstance {
    error OracleOutOfSyncError();
    error OracleOutOfOrderCommitError();

    event OracleUpdated(IOracleProvider newProvider);

    struct Checkpoint { // TODO: naming
        IOracleProvider provider;
        uint96 timestamp; /// @dev The last timestamp that this oracle provider is valid
    }

    struct Global {
        uint128 current;
        uint128 latest;
    }

    function initialize(IOracleProvider initialProvider) external;
    function update(IOracleProvider newProvider) external;
}