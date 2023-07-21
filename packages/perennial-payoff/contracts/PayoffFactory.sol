// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root-v2/contracts/Factory.sol";
import "./interfaces/IPayoffFactory.sol";

// TODO: have this work with instances

/// @title PayoffFactory
/// @notice The payoff factory that manages valid payoff contracts
contract PayoffFactory is IPayoffFactory, Factory {
    /// @notice mapping of payoff provider to whether it is registered
    mapping(IPayoffProvider => bool) public payoffs;

    /// @notice Constructs the contract
    constructor() Factory(address(0)) { }

    /// @notice Initializes the contract state
    function initialize() initializer(1) external {
        __Factory__initialize();
    }

    /// @notice Registers a new payoff provider
    function register(IPayoffProvider payoff) external onlyOwner {
        payoffs[payoff] = true;
        emit PayoffRegistered(payoff);
    }
}
