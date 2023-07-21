// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/attribute/interfaces/IFactory.sol";
import "../types/ProtocolParameter.sol";
import "./IMarket.sol";

interface IMarketFactory is IFactory {
    event ParameterUpdated(ProtocolParameter newParameter);
    event OperatorUpdated(address indexed account, address indexed operator, bool newEnabled);
    event MarketCreated(IMarket indexed market, IMarket.MarketDefinition definition);

    error FactoryInvalidPayoffError();
    error FactoryInvalidOracleError();
    error FactoryAlreadyRegisteredError();

    error ProtocolParameterStorageInvalidError();

    function oracleFactory() external view returns (IFactory);
    function payoffFactory() external view returns (IFactory);
    function parameter() external view returns (ProtocolParameter memory);
    function operators(address account, address operator) external view returns (bool);
    function markets(IOracleProvider oracle, IPayoffProvider payoff) external view returns (IMarket);
    function initialize() external;
    function updateParameter(ProtocolParameter memory newParameter) external;
    function updateOperator(address operator, bool newEnabled) external;
    function create(IMarket.MarketDefinition calldata definition) external returns (IMarket);
    function fund(IMarket market) external;
}
