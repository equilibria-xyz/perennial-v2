// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "../IPayoffProvider.sol";

contract Squared is IPayoffProvider {
    function payoff(Fixed6 price) external pure override returns (Fixed6) {
        return price.mul(price);
    }
}
