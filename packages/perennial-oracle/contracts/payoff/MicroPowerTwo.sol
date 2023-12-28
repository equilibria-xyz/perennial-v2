// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "../interfaces/IPayoffProvider.sol";

contract MicroPowerTwo is IPayoffProvider {
    Fixed18 private constant DIVISOR = Fixed18.wrap(1e24);

    function payoff(Fixed18 price) external pure override returns (Fixed18) {
        return price.mul(price).div(DIVISOR);
    }
}
