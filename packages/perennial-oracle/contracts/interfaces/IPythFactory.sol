// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root-v2/contracts/IFactory.sol";
import "./IOracleProviderFactory.sol";
import "./IPythOracle.sol";

interface IPythFactory is IOracleProviderFactory, IFactory {
    error OracleFactoryInvalidIdError();
    error OracleFactoryAlreadyCreatedError();
    error OracleFactoryNotRegisteredError();
    error OracleFactoryNotCreatedError();

    function initialize() external;
    function create(bytes32 id) external returns (IPythOracle oracle);
}