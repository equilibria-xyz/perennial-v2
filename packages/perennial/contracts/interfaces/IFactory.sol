// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/control/interfaces/IOwnable.sol";
import "@equilibria/root-v2/contracts/IPausable.sol";
import "@openzeppelin/contracts/proxy/beacon/IBeacon.sol";
import "@equilibria/perennial-v2-payoff/contracts/interfaces/IPayoffProvider.sol";
import "../types/ProtocolParameter.sol";
import "./IMarket.sol";

interface IFactory is IBeacon, IOwnable, IPausable {
    event ParameterUpdated(ProtocolParameter newParameter);
    event TreasuryUpdated(address newTreasury);
    event OperatorUpdated(address indexed account, address indexed operator, bool newEnabled);
    event MarketCreated(IMarket indexed market, IMarket.MarketDefinition definition, MarketParameter marketParameter);

    error FactoryNotContractAddressError();
    error FactoryInvalidPayoffError();
    error FactoryInvalidOracleError();
    error FactoryAlreadyRegisteredError();

    error ProtocolParameterStorageInvalidError();

    function parameter() external view returns (ProtocolParameter memory);
    function treasury() external view returns (address);
    function operators(address account, address operator) external view returns (bool);
    function ids(bytes32 oracleId, IPayoffProvider payoff) external view returns (IMarket);
    function markets(IMarket market) external view returns (bool);
    function initialize() external;
    function updateParameter(ProtocolParameter memory newParameter) external;
    function updateTreasury(address newTreasury) external;
    function updateOperator(address operator, bool newEnabled) external;
    function create(IMarket.MarketDefinition calldata definition, MarketParameter calldata marketParameter) external returns (IMarket);
}
