// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/token/types/Token18.sol";
import "@equilibria/root/attribute/interfaces/IFactory.sol";
import "@equilibria/perennial-v2/contracts/interfaces/IOracleProviderFactory.sol";
import "@equilibria/perennial-v2/contracts/interfaces/IMarket.sol";
import "./IOracle.sol";

interface IOracleFactory is IOracleProviderFactory, IFactory {
    event MaxClaimUpdated(UFixed6 newMaxClaim);
    event FactoryRegistered(IOracleProviderFactory factory);
    event CallerAuthorized(IFactory caller);

    error OracleFactoryInvalidIdError();
    error OracleFactoryAlreadyCreatedError();
    error OracleFactoryNotRegisteredError();
    error OracleFactoryNotCreatedError();
    error OracleFactoryClaimTooLargeError();

    function factories(IOracleProviderFactory factory) external view returns (bool);
    function initialize(Token18 incentive) external;
    function register(IOracleProviderFactory factory) external;
    function create(bytes32 id, IOracleProviderFactory factory) external returns (IOracle newOracle);
    function update(bytes32 id, IOracleProviderFactory factory) external;
    function updateMaxClaim(UFixed6 newClaimAmount) external;
    function maxClaim() external view returns (UFixed6);
    function claim(UFixed6 amount) external;
    function callers(IFactory caller) external view returns (bool);
    function fund(IMarket market) external;
}