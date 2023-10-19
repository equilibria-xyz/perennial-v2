// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/token/types/Token6.sol";
import "@equilibria/root/token/types/Token18.sol";
import "@equilibria/root/attribute/interfaces/IFactory.sol";
import "@equilibria/perennial-v2/contracts/interfaces/IOracleProviderFactory.sol";
import "@equilibria/perennial-v2/contracts/interfaces/IMarket.sol";
import "./IOracle.sol";

interface IWrapper {
    function USDC() external view returns (Token6); // solhint-disable-line func-name-mixedcase
    function DSU() external view returns (Token18); // solhint-disable-line func-name-mixedcase

    function wrap(address to) external;
    function unwrap(address to) external;
}

interface IOracleFactory is IOracleProviderFactory, IFactory {
    event MaxClaimUpdated(UFixed6 newMaxClaim);
    event FactoryRegistered(IOracleProviderFactory factory);
    event CallerAuthorized(IFactory caller);

    // sig: 0xe7911099
    error OracleFactoryInvalidIdError();
    // sig: 0xe232e366
    error OracleFactoryAlreadyCreatedError();
    // sig: 0xbbfaa925
    error OracleFactoryNotRegisteredError();
    // sig: 0xfeb0e18c
    error OracleFactoryNotCreatedError();
    // sig: 0x4ddc5544
    error OracleFactoryClaimTooLargeError();

    function factories(IOracleProviderFactory factory) external view returns (bool);
    function initialize(Token18 incentive, IWrapper wrapper) external;
    function register(IOracleProviderFactory factory) external;
    function create(bytes32 id, IOracleProviderFactory factory) external returns (IOracle newOracle);
    function update(bytes32 id, IOracleProviderFactory factory) external;
    function updateMaxClaim(UFixed6 newClaimAmount) external;
    function maxClaim() external view returns (UFixed6);
    function claim(UFixed6 amount) external;
    function callers(IFactory caller) external view returns (bool);
    function fund(IMarket market) external;
}
