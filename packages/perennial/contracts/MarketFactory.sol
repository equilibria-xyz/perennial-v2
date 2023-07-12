// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "@equilibria/root-v2/contracts/Factory.sol";
import "@equilibria/perennial-v2-payoff/contracts/interfaces/IPayoffFactory.sol";
import "@equilibria/perennial-v2-oracle/contracts/interfaces/IOracleFactory.sol";
import "@equilibria/perennial-v2-oracle/contracts/interfaces/IOracleProvider.sol";
import "./interfaces/IMarketFactory.sol";

/**
 * @title MarketFactory
 * @notice Manages creating new markets and global protocol parameters.
 */
contract MarketFactory is IMarketFactory, Factory {
    IFactory public immutable oracleFactory;

    IPayoffFactory public immutable payoffFactory; // TODO(cleanup): can we make this IFactory?

    ProtocolParameterStorage private _parameter;

    mapping(address => mapping(address => bool)) public operators;

    mapping(IOracleProvider => mapping(IPayoffProvider => IMarket)) public markets;

    constructor(
        IOracleFactory oracleFactory_,
        IPayoffFactory payoffFactory_,
        address implementation_
    ) Factory(implementation_) {
        oracleFactory = oracleFactory_;
        payoffFactory = payoffFactory_;
    }

    /**
     * @notice Initializes the contract state
     * @dev Must be called atomically as part of the upgradeable proxy deployment to
     *      avoid front-running
     */
    function initialize() external initializer(1) {
        __Factory__initialize();
    }

    function parameter() public view returns (ProtocolParameter memory) {
        return _parameter.read();
    }

    function updateParameter(ProtocolParameter memory newParameter) public onlyOwner {
        _parameter.store(newParameter);
        emit ParameterUpdated(newParameter);
    }

    function updateOperator(address operator, bool newEnabled) external {
        operators[msg.sender][operator] = newEnabled;
        emit OperatorUpdated(msg.sender, operator, newEnabled);
    }

    /**
     * @notice Creates a new market market with `provider`
     * @return newMarket New market contract address
     */
    function create(
        IMarket.MarketDefinition calldata definition,
        RiskParameter calldata riskParameter
    ) external onlyOwner returns (IMarket newMarket) {
        // verify payoff
        if (definition.payoff != IPayoffProvider(address(0)) && !payoffFactory.payoffs(definition.payoff))
            revert FactoryInvalidPayoffError();

        // verify oracle
        if (!oracleFactory.instances(IInstance(address(definition.oracle)))) revert FactoryInvalidOracleError();

        // verify invariants
        if (markets[definition.oracle][definition.payoff] != IMarket(address(0)))
            revert FactoryAlreadyRegisteredError();

        // create and register market
        newMarket = IMarket(address(_create(abi.encodeCall(IMarket.initialize, (definition, riskParameter)))));
        markets[definition.oracle][definition.payoff] = newMarket;

        emit MarketCreated(newMarket, definition, riskParameter);
    }

    function fund(IMarket market) external {
        market.claimFee();
    }
}
