// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root-v2/contracts/XBeacon.sol";
import "@equilibria/root/control/unstructured/UOwnable.sol";
import "./IPayoffProvider.sol";

contract PayoffFactory is XBeacon, UOwnable {
    mapping(IPayoffProvider => bool) public payoffs;

    constructor(address implementation) XBeacon(implementation) { }

    function initialize() initializer(1) external {
        __UOwnable__initialize();
    }

    function register(IPayoffProvider payoff) external onlyOwner {
        payoffs[payoff] = true;
    }
}
