// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { Fixed6Lib } from "@equilibria/root/number/types/Fixed6.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { Intent } from "../interfaces/IVerifier.sol";
import { IMarket } from "../interfaces/IMarket.sol";

contract MockToken is ERC20 {

    enum Function{ SETTLE, UPDATE, UPDATE_MAKER, UPDATE_INTENT }

    Function private functionToCall;

    constructor() ERC20("MockToken", "MTOKEN") {}

    function transferFrom(address, address, uint256) public override returns (bool) {
        // call method of market contract for reentrancy
        if (functionToCall == Function.UPDATE_MAKER) {
            IMarket(msg.sender).update(address(0), UFixed6Lib.from(0), UFixed6Lib.from(0), UFixed6Lib.from(0), Fixed6Lib.from(0), false);
        } else if (functionToCall == Function.UPDATE) {
            IMarket(msg.sender).update(address(0), Fixed6Lib.from(0), Fixed6Lib.from(0), address(0));
        } else if (functionToCall == Function.UPDATE_INTENT) {
            Intent memory intent;
            IMarket(msg.sender).update(address(0), intent, "");
        } else if (functionToCall == Function.SETTLE){
            IMarket(msg.sender).settle(address(0));
        }

        return true;
    }

    function setFunctionToCall(Function _functionToCall) external {
        functionToCall = _functionToCall;
    }
}
