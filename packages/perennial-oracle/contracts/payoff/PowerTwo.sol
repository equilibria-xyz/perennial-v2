// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import { Fixed18 } from "@equilibria/root/number/types/Fixed18.sol";
import { IPayoffProvider } from "../interfaces/IPayoffProvider.sol";

contract PowerTwo is IPayoffProvider {
    function payoff(Fixed18 price) external pure override returns (Fixed18) {
        return price.mul(price);
    }
}
