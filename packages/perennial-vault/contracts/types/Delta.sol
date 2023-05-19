// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/UFixed18.sol";

/// @dev Delta type
struct Delta {
    uint256 epoch;
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
    function processDeposit(Delta storage self, uint256 epoch, UFixed18 amount) internal {
        self.epoch = epoch;
        self.deposit = self.deposit.add(amount);
    }

    function processRedemption(Delta storage self, uint256 epoch, UFixed18 amount) internal {
        self.epoch = epoch;
        self.redemption = self.redemption.add(amount);
    }

    function clear(Delta storage self, uint256 epoch) internal {
        self.epoch = epoch;
        self.deposit = UFixed18Lib.ZERO;
        self.redemption = UFixed18Lib.ZERO;
    }

    function overwrite(Delta storage self, Delta memory delta) internal {
        self.epoch = delta.epoch;
        self.deposit = delta.deposit;
        self.redemption = delta.redemption;
    }
}
