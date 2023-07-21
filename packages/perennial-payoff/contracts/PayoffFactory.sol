// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/attribute/Factory.sol";
import "./interfaces/IPayoffFactory.sol";

/// @title PayoffFactory
/// @notice The payoff factory that manages valid payoff contracts
contract PayoffFactory is IPayoffFactory, Factory {
    /// @notice Constructs the contract
    constructor() Factory(address(0)) { }

    /// @notice Initializes the contract state
    function initialize() initializer(1) external {
        __Factory__initialize();
    }

    /// @notice Registers a new payoff provider
    function register(IPayoffProvider payoff) external onlyOwner {
        _register(IInstance(address(payoff)));
    }
}
