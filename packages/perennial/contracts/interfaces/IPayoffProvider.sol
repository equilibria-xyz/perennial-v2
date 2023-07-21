// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/Fixed6.sol";

interface IPayoffProvider {
    function payoff(Fixed6 price) external pure returns (Fixed6 payoff);
}
