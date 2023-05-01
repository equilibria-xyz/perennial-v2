// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "../IPayoffProvider.sol";

contract MilliSquared is IPayoffProvider {
    function payoff(Fixed6 price) external pure override returns (Fixed6) {
        return price.mul(price).div(Fixed6Lib.from(1000));
    }
}
