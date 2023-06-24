// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/control/unstructured/UOwnable.sol";
import "./interfaces/IPayoffFactory.sol";

contract PayoffFactory is IPayoffFactory, UOwnable {
    mapping(IPayoffProvider => bool) public payoffs;

    function initialize() initializer(1) external {
        __UOwnable__initialize();
    }

    function register(IPayoffProvider payoff) external onlyOwner {
        payoffs[payoff] = true;
    }
}
