// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import { UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { Token18 } from "@equilibria/root/token/types/Token18.sol";
import { Factory } from "@equilibria/root/attribute/Factory.sol";
import { IOracleProvider } from "@perennial/v2-core/contracts/interfaces/IOracleProvider.sol";
import { IOracleProviderFactory } from "@perennial/v2-core/contracts/interfaces/IOracleProviderFactory.sol";
import { IOracleFactory } from "./interfaces/IOracleFactory.sol";
import { OracleParameter, OracleParameterStorage } from "./types/OracleParameter.sol";
import { IOracle } from "./interfaces/IOracle.sol";

/// @title OracleFactory
/// @notice Factory for creating and managing oracles
contract OracleFactory is IOracleFactory, Factory {
    /// @notice Mapping of oracle id to oracle instance
    mapping(bytes32 => IOracleProvider) public oracles;

    /// @notice Mapping of factory to whether it is registered
    mapping(IOracleProviderFactory => bool) public factories;

    /// @notice Mapping of oracle instance to oracle id
    mapping(IOracleProvider => bytes32) public ids;

    /// @notice Global settings for all oracles
    OracleParameterStorage private _parameter;

    /// @notice Constructs the contract
    /// @param implementation_ The implementation contract for the oracle
    constructor(address implementation_) Factory(implementation_) { }

    /// @notice Initializes the contract state
    function initialize() external initializer(3) {
        // Re-initialize if owner is unset
        if (owner() == address(0)) __Factory__initialize();

        _parameter.store(OracleParameter(1, UFixed6Lib.ZERO, UFixed6Lib.ZERO));
    }

    /// @notice Returns the global oracle parameter
    /// @return The global oracle parameter
    function parameter() external view returns (OracleParameter memory) {
        return _parameter.read();
    }

    /// @notice Updates the global oracle parameter
    /// @param newParameter The new oracle parameter
    function updateParameter(OracleParameter memory newParameter) external onlyOwner {
        _parameter.store(newParameter);
    }

    /// @notice Registers a new oracle provider factory to be used in the underlying oracle instances
    /// @param factory The factory to register
    function register(IOracleProviderFactory factory) external onlyOwner {
        factories[factory] = true;
        emit FactoryRegistered(factory);
    }

    /// @notice Creates a new oracle instance
    /// @param id The id of the oracle to create
    /// @param factory The initial underlying oracle factory for this oracle to use
    /// @param name The name of the oracle
    /// @return newOracle The newly created oracle instance
    function create(bytes32 id, IOracleProviderFactory factory, string calldata name) external onlyOwner returns (IOracle newOracle) {
        if (!factories[factory]) revert OracleFactoryNotRegisteredError();
        if (oracles[id] != IOracleProvider(address(0))) revert OracleFactoryAlreadyCreatedError();

        IOracleProvider oracleProvider = factory.oracles(id);
        if (oracleProvider == IOracleProvider(address(0))) revert OracleFactoryInvalidIdError();

        newOracle = IOracle(address(_create(abi.encodeCall(IOracle.initialize, (oracleProvider, name)))));
        oracles[id] = newOracle;
        ids[newOracle] = id;

        emit OracleCreated(newOracle, id);
    }

    /// @notice Updates the underlying oracle factory for an oracle instance
    /// @param id The id of the oracle to update
    /// @param factory The new underlying oracle factory for this oracle to use
    function update(bytes32 id, IOracleProviderFactory factory) external onlyOwner {
        if (!factories[factory]) revert OracleFactoryNotRegisteredError();
        if (oracles[id] == IOracleProvider(address(0))) revert OracleFactoryNotCreatedError();

        IOracleProvider oracleProvider = factory.oracles(id);
        if (oracleProvider == IOracleProvider(address(0))) revert OracleFactoryInvalidIdError();

        IOracle oracle = IOracle(address(oracles[id]));
        oracle.update(oracleProvider);
    }
}
