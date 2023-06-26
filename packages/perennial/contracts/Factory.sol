// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "@equilibria/root-v2/contracts/UPausable.sol";
import "@equilibria/root-v2/contracts/XBeacon.sol";
import "@equilibria/root/control/unstructured/UOwnable.sol";
import "@equilibria/perennial-v2-payoff/contracts/interfaces/IPayoffFactory.sol";
import "@equilibria/perennial-v2-oracle/contracts/interfaces/IOracleFactory.sol";
import "./interfaces/IFactory.sol";

/**
 * @title Factory
 * @notice Manages creating new markets and global protocol parameters.
 */
contract Factory is IFactory, XBeacon, UOwnable, UPausable {
    IOracleFactory public immutable oracleFactory;
    IPayoffFactory public immutable payoffFactory;

    ProtocolParameterStorage private _parameter;

    /// @dev Protocol pauser address. address(0) defaults to owner(0)
    address private _treasury;

    mapping(address => mapping(address => bool)) public operators;

    mapping(bytes32 => mapping(IPayoffProvider => IMarket)) public ids;
    mapping(IMarket => bool) public markets;

    constructor(
        IOracleFactory oracleFactory_,
        IPayoffFactory payoffFactory_,
        address implementation_
    ) XBeacon(implementation_) {
        oracleFactory = oracleFactory_;
        payoffFactory = payoffFactory_;
    }

    /**
     * @notice Initializes the contract state
     * @dev Must be called atomically as part of the upgradeable proxy deployment to
     *      avoid front-running
     */
    function initialize() external initializer(1) {
        __UOwnable__initialize();
    }

    function updateParameter(ProtocolParameter memory newParameter) public onlyOwner {
        _parameter.store(newParameter);
        emit ParameterUpdated(newParameter);
    }

    /**
     * @notice Updates the treasury of an existing coordinator
     * @dev Must be called by the current owner. Defaults to the coordinator `owner` if set to address(0)
     * @param newTreasury New treasury address
     */
    function updateTreasury(address newTreasury) external onlyOwner {
        _treasury = newTreasury;
        emit TreasuryUpdated(newTreasury);
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
        MarketParameter calldata marketParameter
    ) external onlyOwner returns (IMarket newMarket) {
        // verify payoff
        if (
            marketParameter.payoff != IPayoffProvider(address(0)) &&
            payoffFactory.payoffs(marketParameter.payoff) == false
        ) revert FactoryInvalidPayoffError();

        // verify oracle
        bytes32 oracleId = oracleFactory.ids(marketParameter.oracle);
        if (oracleId == bytes32(0)) revert FactoryInvalidOracleError();

        // verify invariants
        if (ids[oracleId][marketParameter.payoff] != IMarket(address(0))) revert FactoryAlreadyRegisteredError();

        // create and register market
        newMarket = IMarket(create(abi.encodeCall(IMarket.initialize, (definition, marketParameter))));
        ids[oracleId][marketParameter.payoff] = newMarket;
        markets[newMarket] = true;

        emit MarketCreated(newMarket, definition, marketParameter);
    }

    function parameter() public view returns (ProtocolParameter memory) {
        return _parameter.read();
    }

    function treasury() external view returns (address) {
        return _treasury == address(0) ? owner() : _treasury;
    }
}
