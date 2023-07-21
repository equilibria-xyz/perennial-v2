// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "@equilibria/root/attribute/Factory.sol";
import "./interfaces/IPayoffProvider.sol";
import "./interfaces/IOracleProvider.sol";
import "./interfaces/IMarketFactory.sol";

/// @title MarketFactory
/// @notice Manages creating new markets and global protocol parameters.
contract MarketFactory is IMarketFactory, Factory {
    /// @dev The oracle factory
    IFactory public immutable oracleFactory;

    /// @dev The payoff factory
    IFactory public immutable payoffFactory;

    /// @dev The global protocol parameters
    ProtocolParameterStorage private _parameter;

    /// @dev Mapping of allowed operators for each account
    mapping(address => mapping(address => bool)) public operators;

    /// @dev Registry of created markets by oracle and payoff
    mapping(IOracleProvider => mapping(IPayoffProvider => IMarket)) public markets;

    /// @notice Constructs the contract
    /// @param oracleFactory_ The oracle factory
    /// @param payoffFactory_ The payoff factory
    /// @param implementation_ The initial market implementation contract
    constructor(IFactory oracleFactory_, IFactory payoffFactory_, address implementation_) Factory(implementation_) {
        oracleFactory = oracleFactory_;
        payoffFactory = payoffFactory_;
    }

    /// @notice Initializes the contract state
    function initialize() external initializer(1) {
        __Factory__initialize();
    }

    /// @notice Returns the global protocol parameters
    function parameter() public view returns (ProtocolParameter memory) {
        return _parameter.read();
    }

    /// @notice Updates the global protocol parameters
    /// @param newParameter The new protocol parameters
    function updateParameter(ProtocolParameter memory newParameter) public onlyOwner {
        _parameter.store(newParameter);
        emit ParameterUpdated(newParameter);
    }

    /// @notice Updates the status of an operator for the caller
    /// @param operator The operator to update
    /// @param newEnabled The new status of the operator
    function updateOperator(address operator, bool newEnabled) external {
        operators[msg.sender][operator] = newEnabled;
        emit OperatorUpdated(msg.sender, operator, newEnabled);
    }

    /// @notice Creates a new market market with the given definition
    /// @param definition The market definition
    /// @return newMarket New market contract address
    function create(IMarket.MarketDefinition calldata definition) external onlyOwner returns (IMarket newMarket) {
        // verify payoff
        if (
            definition.payoff != IPayoffProvider(address(0)) &&
            !payoffFactory.instances(IInstance(address(definition.payoff)))
        ) revert FactoryInvalidPayoffError();

        // verify oracle
        if (!oracleFactory.instances(IInstance(address(definition.oracle)))) revert FactoryInvalidOracleError();

        // verify invariants
        if (markets[definition.oracle][definition.payoff] != IMarket(address(0)))
            revert FactoryAlreadyRegisteredError();

        // create and register market
        newMarket = IMarket(address(_create(abi.encodeCall(IMarket.initialize, (definition)))));
        markets[definition.oracle][definition.payoff] = newMarket;

        emit MarketCreated(newMarket, definition);
    }

    /// @notice Claims the protocol's fee from the given market
    /// @param market The market to claim from
    function fund(IMarket market) external {
        if (!instances(IInstance(address(market)))) revert FactoryNotInstanceError();
        market.claimFee();
    }
}
