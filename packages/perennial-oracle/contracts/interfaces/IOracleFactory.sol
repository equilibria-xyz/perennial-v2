// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root-v2/contracts/IFactory.sol";
import "./IOracleProviderFactory.sol";
import "./IOracle.sol";

interface IOracleFactory is IOracleProviderFactory, IFactory {
    error OracleFactoryInvalidIdError();
    error OracleFactoryAlreadyCreatedError();
    error OracleFactoryNotRegisteredError();
    error OracleFactoryNotCreatedError();

    function factories(IOracleFactory factory) external view returns (bool);
    function initialize() external;
    function register(IOracleFactory factory) external;
    function create(bytes32 id, IOracleFactory factory) external returns (IOracle newOracle);
    function update(bytes32 id, IOracleFactory factory) external;
}