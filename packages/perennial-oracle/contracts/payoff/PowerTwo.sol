// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import "../interfaces/IPayoffProvider.sol";

contract PowerTwo is IPayoffProvider {
    function payoff(Fixed18 price) external pure override returns (Fixed18) {
        return price.mul(price);
    }
}
