// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Token18 } from "@equilibria/root/token/types/Token18.sol";
import { IFactory } from "@equilibria/root/attribute/interfaces/IFactory.sol";
import { IOracleProvider } from "@perennial/v2-core/contracts/interfaces/IOracleProvider.sol";
import { IOracleProviderFactory } from "@perennial/v2-core/contracts/interfaces/IOracleProviderFactory.sol";
import { IOracle } from "./IOracle.sol";
import { OracleParameter } from "../types/OracleParameter.sol";

interface IOracleFactory is IOracleProviderFactory, IFactory {
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

    function factories(IOracleProviderFactory factory) external view returns (bool);
    function initialize() external;
    function parameter() external view returns (OracleParameter memory);
    function updateParameter(OracleParameter memory newParameter) external;
    function register(IOracleProviderFactory factory) external;
    function create(bytes32 id, IOracleProviderFactory factory, string calldata name) external returns (IOracle newOracle);
    function update(bytes32 id, IOracleProviderFactory factory) external;
}
