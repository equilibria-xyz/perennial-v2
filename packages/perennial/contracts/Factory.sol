// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "@equilibria/root-v2/contracts/XBeacon.sol";
import "@equilibria/root/control/unstructured/UOwnable.sol";
import "@equilibria/perennial-v2-payoff/contracts/interfaces/IPayoffFactory.sol";
import "./interfaces/IFactory.sol";

/**
 * @title Factory
 * @notice Manages creating new markets and global protocol parameters.
 */
contract Factory is IFactory, XBeacon, UOwnable {
    IPayoffFactory public immutable payoffFactory;

    ProtocolParameterStorage private _parameter;

    /// @dev Protocol pauser address. address(0) defaults to owner(0)
    address private _treasury;

    /// @dev Protocol pauser address. address(0) defaults to owner(0)
    address private _pauser;

    mapping(address => mapping(address => bool)) public operators;

    mapping(IMarket => bool) public markets;

    constructor(IPayoffFactory payoffFactory_, address implementation_) XBeacon(implementation_) {
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

    /**
     * @notice Updates the protocol pauser address. Zero address defaults to owner(0)
     * @param newPauser New protocol pauser address
     */
    function updatePauser(address newPauser) public onlyOwner {
        _pauser = newPauser;
        emit PauserUpdated(newPauser);
    }

    function updateOperator(address operator, bool newEnabled) external {
        operators[msg.sender][operator] = newEnabled;
        emit OperatorUpdated(msg.sender, operator, newEnabled);
    }

    /**
     * @notice Creates a new market market with `provider`
     * @return newMarket New market contract address
     */
    function createMarket(
        IMarket.MarketDefinition calldata definition,
        MarketParameter calldata marketParameter
    ) external returns (IMarket newMarket) {
        if (payoffFactory.payoffs(marketParameter.payoff) == false) revert FactoryInvalidPayoffError();

        newMarket = IMarket(create(abi.encodeCall(IMarket.initialize, (definition, marketParameter))));
        newMarket.updatePendingOwner(msg.sender);
        markets[newMarket] = true;

        emit MarketCreated(newMarket, definition, marketParameter);
    }

    function parameter() public view returns (ProtocolParameter memory) {
        return _parameter.read();
    }

    function treasury() external view returns (address) {
        return _treasury == address(0) ? owner() : _treasury;
    }

    function pauser() public view returns (address) {
        return _pauser == address(0) ? owner() : _pauser;
    }

    /**
     * @notice Updates the protocol paused state
     * @param newPaused New protocol paused state
     */
    function updatePaused(bool newPaused) public {
        if (msg.sender != pauser()) revert FactoryNotPauserError();
        ProtocolParameter memory newParameter = parameter();
        newParameter.paused = newPaused;
        _parameter.store(newParameter);
        emit ParameterUpdated(newParameter);
    }
}
