// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import { Fixed18, Fixed18Lib } from "@equilibria/root/number/types/Fixed18.sol";
import { IPayoffProvider } from "../interfaces/IPayoffProvider.sol";

contract Inverse is IPayoffProvider {
    function payoff(Fixed18 price) external pure override returns (Fixed18) {
        return price.isZero() ? price : Fixed18Lib.ONE.div(price);
    }
}
