// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/UFixed18.sol";

/// @dev Delta type
struct Delta {
    uint256 version; // TODO: remove?
    UFixed18 deposit;
    UFixed18 redemption;
}
using DeltaLib for Delta global;

/**
 * @title DeltaLib
 * @notice
 * @dev
 */
library DeltaLib {
    function processDeposit(Delta storage self, uint256 version, UFixed18 amount) internal {
        self.version = version;
        self.deposit = self.deposit.add(amount);
    }

    function processRedemption(Delta storage self, uint256 version, UFixed18 amount) internal {
        self.version = version;
        self.redemption = self.redemption.add(amount);
    }

    function clear(Delta storage self) internal {
        self.deposit = UFixed18Lib.ZERO;
        self.redemption = UFixed18Lib.ZERO;
    }
}
