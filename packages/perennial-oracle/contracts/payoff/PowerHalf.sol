// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { UFixed18 } from "@equilibria/root/number/types/UFixed18.sol";
import { Fixed18, Fixed18Lib } from "@equilibria/root/number/types/Fixed18.sol";
import { IPayoffProvider } from "../interfaces/IPayoffProvider.sol";

contract PowerHalf is IPayoffProvider {
    uint256 private constant BASE = 1e18;

    function payoff(Fixed18 price) external pure override returns (Fixed18) {
        return Fixed18Lib.from(UFixed18.wrap(Math.sqrt(UFixed18.unwrap(price.abs()) * BASE)));
    }
}
