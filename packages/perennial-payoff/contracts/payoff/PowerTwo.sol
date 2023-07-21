// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "@equilibria/perennial-v2/contracts/interfaces/IPayoffProvider.sol";

contract PowerTwo is IPayoffProvider {
    function payoff(Fixed6 price) external pure override returns (Fixed6) {
        return price.mul(price);
    }
}
