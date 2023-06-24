// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/control/interfaces/IOwnable.sol";
import "@openzeppelin/contracts/proxy/beacon/IBeacon.sol";
import "./IMarket.sol";
import "../types/ProtocolParameter.sol";

interface IFactory is IBeacon, IOwnable {
    event ParameterUpdated(ProtocolParameter newParameter);
    event TreasuryUpdated(address newTreasury);
    event PauserUpdated(address newPauser);
    event OperatorUpdated(address indexed account, address indexed operator, bool newEnabled);
    event MarketCreated(IMarket indexed market, IMarket.MarketDefinition definition, MarketParameter marketParameter);

    error FactoryNotPauserError();
    error FactoryPausedError();
    error FactoryNotContractAddressError();
    error FactoryInvalidPayoffError();

    error ProtocolParameterStorageInvalidError();

    function parameter() external view returns (ProtocolParameter memory);
    function treasury() external view returns (address);
    function pauser() external view returns (address);
    function operators(address account, address operator) external view returns (bool);
    function markets(IMarket market) external view returns (bool);
    function initialize() external;
    function updateParameter(ProtocolParameter memory newParameter) external;
    function updateTreasury(address newTreasury) external;
    function updatePauser(address newPauser) external;
    function updateOperator(address operator, bool newEnabled) external;
    function createMarket(IMarket.MarketDefinition calldata definition, MarketParameter calldata marketParameter) external returns (IMarket);
    function updatePaused(bool newPaused) external;
}
