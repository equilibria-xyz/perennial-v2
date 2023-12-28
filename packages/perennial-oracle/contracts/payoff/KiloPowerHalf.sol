// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "../interfaces/IPayoffProvider.sol";

contract KiloPowerHalf is IPayoffProvider {
    uint256 private constant BASE = 1e18;
    UFixed18 private constant MULTIPLICAND = UFixed18.wrap(1e21);

    function payoff(Fixed18 price) external pure override returns (Fixed18) {
        return
            Fixed18Lib.from(
                UFixed18.wrap(Math.sqrt(UFixed18.unwrap(price.abs().mul(MULTIPLICAND).mul(MULTIPLICAND)) * BASE))
            );
    }
}
