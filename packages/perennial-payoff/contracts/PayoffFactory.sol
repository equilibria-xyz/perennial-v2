// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root-v2/contracts/Factory.sol";
import "./interfaces/IPayoffFactory.sol";

contract PayoffFactory is IPayoffFactory, Factory {
    mapping(IPayoffProvider => bool) public payoffs;

    constructor() Factory(address(0)) { }

    function initialize() initializer(1) external {
        __Factory__initialize();
    }

    function register(IPayoffProvider payoff) external onlyOwner {
        payoffs[payoff] = true;
        emit PayoffRegistered(payoff);
    }
}
