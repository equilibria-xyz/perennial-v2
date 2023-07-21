// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "@equilibria/root/token/types/Token18.sol";
import "@equilibria/root/attribute/Factory.sol";
import "@equilibria/perennial-v2/contracts/interfaces/IOracleProviderFactory.sol";
import "./interfaces/IOracleFactory.sol";

/// @title OracleFactory
/// @notice Factory for creating and managing oracles
contract OracleFactory is IOracleFactory, Factory {
    /// @notice The token that is paid out as a reward to oracle keepers
    Token18 public incentive;

    /// @notice The maximum amount of tokens that can be rewarded in a single price update
    UFixed6 public maxClaim;

    /// @notice Mapping of which factory's instances are authorized to request from this contract
    mapping(IFactory => bool) public callers;

    /// @notice Mapping of oracle id to oracle instance
    mapping(bytes32 => IOracleProvider) public oracles;

    /// @notice Mapping of factory to whether it is registered
    mapping(IOracleProviderFactory => bool) public factories;

    /// @notice Constructs the contract
    /// @param implementation_ The implementation contract for the oracle
    constructor(address implementation_) Factory(implementation_) { }

    /// @notice Initializes the contract state
    /// @param incentive_ The token that is paid out as a reward to oracle keepers
    function initialize(Token18 incentive_) external initializer(1) {
        __UOwnable__initialize();

        incentive = incentive_;
    }

    /// @notice Registers a new oracle provider factory to be used in the underlying oracle instances
    /// @param factory The factory to register
    function register(IOracleProviderFactory factory) external onlyOwner {
        factories[factory] = true;
        emit FactoryRegistered(factory);
    }

    /// @notice Authorizes a factory's instances to request from this contract
    /// @param caller The factory to authorize
    function authorize(IFactory caller) external onlyOwner {
        callers[caller] = true;
        emit CallerAuthorized(caller);
    }

    /// @notice Creates a new oracle instance
    /// @param id The id of the oracle to create
    /// @param factory The initial underlying oracle factory for this oracle to use
    /// @return newOracle The newly created oracle instance
    function create(bytes32 id, IOracleProviderFactory factory) external onlyOwner returns (IOracle newOracle) {
        if (!factories[factory]) revert OracleFactoryNotRegisteredError();
        if (oracles[id] != IOracleProvider(address(0))) revert OracleFactoryAlreadyCreatedError();

        IOracleProvider oracleProvider = factory.oracles(id);
        if (oracleProvider == IOracleProvider(address(0))) revert OracleFactoryInvalidIdError();

        newOracle = IOracle(address(_create(abi.encodeCall(IOracle.initialize, (oracleProvider)))));
        oracles[id] = newOracle;

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

    /// @notice Updates the maximum amount of tokens that can be rewarded in a single price update
    function updateMaxClaim(UFixed6 newMaxClaim) external onlyOwner {
        maxClaim = newMaxClaim;
        emit MaxClaimUpdated(newMaxClaim);
    }

    /// @notice Claims an amount of incentive tokens, to be paid out as a reward to the keeper
    /// @dev Can only be called by a registered underlying oracle provider factory
    /// @param amount The amount of tokens to claim
    function claim(UFixed6 amount) external {
        if (amount.gt(maxClaim)) revert OracleFactoryClaimTooLargeError();
        if (!factories[IOracleProviderFactory(msg.sender)]) revert OracleFactoryNotRegisteredError();
        incentive.push(msg.sender, UFixed18Lib.from(amount));
    }

    /// @notice Checks whether a caller is authorized to request from this contract
    /// @param caller The caller to check
    /// @return Whether the caller is authorized
    function authorized(address caller) external view returns (bool) {
        IInstance callerInstance = IInstance(caller);
        IFactory callerFactory = callerInstance.factory();
        if (!callerFactory.instances(callerInstance)) return false;
        return callers[callerFactory];
    }

    // @notice Claims the oracle's fee from the given market
    /// @param market The market to claim from
    function fund(IMarket market) external {
        if (!instances(IInstance(address(market.oracle())))) revert FactoryNotInstanceError();
        market.claimFee();
    }
}
