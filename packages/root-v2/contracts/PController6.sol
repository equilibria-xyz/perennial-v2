// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/Fixed6.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

/// @dev PController6 type
struct PController6 {
    Fixed6 value;
    UFixed6 _k;
    Fixed6 _skew;
    UFixed6 _max;
}
using PController6Lib for PController6 global;

/**
 * @title PController6Lib
 * @notice
 * @dev
 */
library PController6Lib {
    function compute(
        PController6 memory self,
        Fixed6 skew,
        uint256 fromTimestamp,
        uint256 toTimestamp
    ) internal pure returns (Fixed6) {
        return self.value
            .add(Fixed6Lib.from(int256(toTimestamp - fromTimestamp)).mul(skew).div(Fixed6Lib.from(self._k)));
    }

    function accumulate(
        PController6 memory self,
        Fixed6 skew,
        uint256 fromTimestamp,
        uint256 toTimestamp,
        UFixed6 notional
    ) internal pure returns (Fixed6 accumulated) {
        Fixed6 newValue = compute(self, skew, fromTimestamp, toTimestamp);
        UFixed6 totalElapsed = UFixed6Lib.from(toTimestamp - fromTimestamp);
        UFixed6 totalRange = self.value.sub(newValue).abs();
        UFixed6 outOfRangeAfter = Fixed6Lib.from(newValue.abs()).sub(Fixed6Lib.from(self._max)).abs();

        UFixed6 afterTimestamp = newValue.abs().lte(self._max) ?
            UFixed6Lib.from(toTimestamp) :
            UFixed6Lib.from(fromTimestamp).add(totalElapsed.muldiv(outOfRangeAfter, totalRange));

        // in range
        accumulated = self.value.add(newValue)
            .mul(Fixed6Lib.from(afterTimestamp).sub(Fixed6Lib.from(int256(fromTimestamp))))
            .mul(Fixed6Lib.from(notional))
            .div(Fixed6Lib.from(365 days))
            .div(Fixed6Lib.from(2));

        // out of range (after)
        accumulated = Fixed6Lib.from(newValue.sign(), self._max)
            .mul(Fixed6Lib.from(int256(toTimestamp)).sub(Fixed6Lib.from(afterTimestamp)))
            .mul(Fixed6Lib.from(notional))
            .div(Fixed6Lib.from(365 days))
            .add(accumulated);

        self.value = newValue.abs().gt(self._max) ? Fixed6Lib.from(newValue.sign(), self._max) : newValue;
        self._skew = skew;
    }
}
