// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "../interfaces/IPayoffProvider.sol";

contract Inverse is IPayoffProvider {
    function payoff(Fixed18 price) external pure override returns (Fixed18) {
        return Fixed18Lib.ONE.div(price);
    }
}
