// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/Fixed6.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./PController6.sol";

/// @dev PAccumulator6 type
struct PAccumulator6 {
    Fixed6 _value;
    Fixed6 _skew;
}
using PAccumulator6Lib for PAccumulator6 global;

/**
 * @title PAccumulator6Lib
 * @notice
 * @dev
 */
library PAccumulator6Lib {
    function accumulate(
        PAccumulator6 memory self,
        PController6 memory controller,
        Fixed6 skew,
        uint256 fromTimestamp,
        uint256 toTimestamp,
        UFixed6 notional
    ) internal pure returns (Fixed6 accumulated) {
        Fixed6 newValue = controller.compute(self._value, skew, fromTimestamp, toTimestamp);
        Fixed6 newMax = Fixed6Lib.from(newValue.sign(), controller.max);

        UFixed6 totalElapsed = UFixed6Lib.from(toTimestamp - fromTimestamp);
        UFixed6 totalRange = self._value.sub(newValue).abs();
        UFixed6 outOfRangeAfter = Fixed6Lib.from(newValue.abs()).sub(Fixed6Lib.from(controller.max)).abs();
        UFixed6 afterTimestamp = newValue.abs().lte(controller.max) ?
            UFixed6Lib.from(toTimestamp) :
            UFixed6Lib.from(fromTimestamp).add(totalElapsed.muldiv(outOfRangeAfter, totalRange));

        // in range
        accumulated = _accumulate(self._value.add(newValue), UFixed6Lib.from(fromTimestamp), afterTimestamp, notional)
            .div(Fixed6Lib.from(2));

        // out of range (after)
        accumulated = _accumulate(newMax, afterTimestamp, UFixed6Lib.from(toTimestamp), notional).add(accumulated);

        self._value = newValue.abs().gt(controller.max) ? newMax : newValue;
        self._skew = skew;
    }

    function _accumulate(
        Fixed6 rate,
        UFixed6 fromTimestamp,
        UFixed6 toTimestamp,
        UFixed6 notional
    ) private pure returns (Fixed6) {
        return rate
            .mul(Fixed6Lib.from(toTimestamp.sub(fromTimestamp)))
            .mul(Fixed6Lib.from(notional))
            .div(Fixed6Lib.from(365 days));
    }
}
