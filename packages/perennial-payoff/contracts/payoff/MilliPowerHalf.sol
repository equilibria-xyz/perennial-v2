// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@equilibria/perennial-v2/contracts/interfaces/IPayoffProvider.sol";

contract MilliPowerHalf is IPayoffProvider {
    uint256 private constant BASE = 1e6;
    Fixed6 private constant DIVISOR = Fixed6.wrap(1e9);

    function payoff(Fixed6 price) external pure override returns (Fixed6) {
        return Fixed6Lib.from(UFixed6.wrap(Math.sqrt(UFixed6.unwrap(price.abs()) * BASE))).div(DIVISOR);
    }
}
