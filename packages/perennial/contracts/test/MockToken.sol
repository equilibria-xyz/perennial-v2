// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import "../interfaces/IMarket.sol";

contract MockToken is ERC20 {

    constructor() ERC20("MockToken", "MTOKEN") {}

    function transfer(address, uint256) public override returns (bool) {
        // call update method of market contract for reentrancy
        IMarket(msg.sender).update(address(0), UFixed6Lib.from(0), UFixed6Lib.from(0), UFixed6Lib.from(0), Fixed6Lib.from(0), false);
    }

    function transferFrom(address, address, uint256) public override returns (bool) {
        // call update method of market contract for reentrancy
        IMarket(msg.sender).update(address(0), UFixed6Lib.from(0), UFixed6Lib.from(0), UFixed6Lib.from(0), Fixed6Lib.from(0), false);
    }
}
