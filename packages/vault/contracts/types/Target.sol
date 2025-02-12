// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Fixed6 } from"@equilibria/root/number/types/Fixed6.sol";

/// @dev The target allocation for a market
struct Target {
    /// @dev The collateral delta
    Fixed6 collateral;

    /// @dev The maker position delta
    Fixed6 maker;

    /// @dev The taker position delta
    Fixed6 taker;
}
