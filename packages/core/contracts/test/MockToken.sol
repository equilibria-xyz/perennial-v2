// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Fixed6Lib } from "@equilibria/root/number/types/Fixed6.sol";
import { UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IMargin, IMarket } from "../interfaces/IMargin.sol";

contract MockToken is ERC20 {
    enum Function{ NONE, DEPOSIT, WITHDRAW, ISOLATE, ADJUST_ISOLATED_BALANCE, CROSS }

    Function private functionToCall;

    constructor() ERC20("MockToken", "MTOKEN") {
        // mint 1 million tokens to owner
        _mint(msg.sender, 1000000e18);
    }

    function transferFrom(address, address, uint256) public override returns (bool) {
        _makeReentrantCall();
        return true;
    }

    function transfer(address, uint256) public override returns (bool) {
        _makeReentrantCall();
        return true;
    }

    function _makeReentrantCall() private {
        if (functionToCall == Function.DEPOSIT) {
            IMargin(msg.sender).deposit(address(0), UFixed6Lib.from(0));
        } else if (functionToCall == Function.WITHDRAW) {
            IMargin(msg.sender).withdraw(address(0), UFixed6Lib.from(0));
        } else if (functionToCall == Function.ISOLATE) {
            IMargin(msg.sender).isolate(IMarket(address(0)));
        } else if (functionToCall == Function.ADJUST_ISOLATED_BALANCE) {
            IMargin(msg.sender).adjustIsolatedBalance(IMarket(address(0)), Fixed6Lib.from(0));
        } else if (functionToCall == Function.CROSS) {
            IMargin(msg.sender).cross(IMarket(address(0)));
        }
    }

    function setFunctionToCall(Function _functionToCall) external {
        functionToCall = _functionToCall;
    }
}
