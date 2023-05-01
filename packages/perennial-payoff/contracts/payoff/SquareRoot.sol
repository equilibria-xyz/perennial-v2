// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/utils/math/SignedMath.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "../IPayoffProvider.sol";

contract SquareRoot is IPayoffProvider {
    function payoff(Fixed6 price) external pure override returns (Fixed6) {
        return Fixed6.wrap(int256(Math.sqrt(SignedMath.abs(Fixed6.unwrap(price)) * 1e6)));
    }
}
