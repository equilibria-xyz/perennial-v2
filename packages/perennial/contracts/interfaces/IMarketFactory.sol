// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/attribute/interfaces/IFactory.sol";
import "../types/ProtocolParameter.sol";
import "./IMarket.sol";

interface IMarketFactory is IFactory {
    event ParameterUpdated(ProtocolParameter newParameter);
    event OperatorUpdated(address indexed account, address indexed operator, bool newEnabled);
    event ReferralFeeUpdated(address indexed referrer, UFixed6 newFee);
    event MarketCreated(IMarket indexed market, IMarket.MarketDefinition definition);

    // sig: 0x0a37dc74
    error FactoryInvalidPayoffError();
    // sig: 0x5116bce5
    error FactoryInvalidOracleError();
    // sig: 0x213e2260
    error FactoryAlreadyRegisteredError();

    // sig: 0x4dc1bc59
    error ProtocolParameterStorageInvalidError();

    function oracleFactory() external view returns (IFactory);
    function parameter() external view returns (ProtocolParameter memory);
    function operators(address account, address operator) external view returns (bool);
    function referralFee(address referrer) external view returns (UFixed6);
    function markets(IOracleProvider oracle) external view returns (IMarket);
    function initialize() external;
    function updateParameter(ProtocolParameter memory newParameter) external;
    function updateOperator(address operator, bool newEnabled) external;
    function updateReferralFee(address referrer, UFixed6 newReferralFee) external;
    function create(IMarket.MarketDefinition calldata definition) external returns (IMarket);
}
