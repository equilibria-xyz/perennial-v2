// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/Fixed6.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

/// @dev PController6 type
struct PController6 {
    UFixed6 k;
    UFixed6 max;
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
        Fixed6 value,
        Fixed6 skew,
        uint256 fromTimestamp,
        uint256 toTimestamp
    ) internal pure returns (Fixed6 newValue, UFixed6 interceptTimestamp) {
        Fixed6 newValueUncapped = value.add(
            Fixed6Lib.from(int256(toTimestamp - fromTimestamp))
                .mul(skew)
                .div(Fixed6Lib.from(self.k))
        );

        newValue = Fixed6Lib.from(newValueUncapped.sign(), self.max.min(newValueUncapped.abs()));

        (UFixed6 distance, Fixed6 range) = (UFixed6Lib.from(toTimestamp - fromTimestamp), newValueUncapped.sub(value));
        UFixed6 buffer = value.abs().gt(self.max) ?
            UFixed6Lib.ZERO :
            Fixed6Lib.from(range.sign(), self.max).sub(value).abs();
        interceptTimestamp = range.isZero() ?
            UFixed6Lib.from(toTimestamp) :
            UFixed6Lib.from(fromTimestamp).add(distance.muldiv(buffer, range.abs())).min(UFixed6Lib.from(toTimestamp));
    }
}
