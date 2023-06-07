// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "./Fixed6.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

/// @dev PController6 type
struct PController6 {
    UFixed6 _k;
    Fixed6 _value;
    Fixed6 _skew;
    uint256 _latest;
}
using PController6Lib for PController6 global;

/**
 * @title PController6Lib
 * @notice
 * @dev
 */
library PController6Lib {
    function accumulated(PController6 memory self, Fixed6 skew, UFixed6 total, uint256 timestamp) internal pure returns (Fixed6) {
        self._value = Fixed6Lib.from(int256(timestamp - self._latest)) // TODO: idk if this is the best precision arrangement
            .mul(Fixed6Lib.from(self._k).mul(self._skew).add(Fixed6Lib.from(self._k).mul(skew)))
            .div(2);
        self._skew = skew;
        self._latest = timestamp;

        return _mul(self._value, total);
    }

    function _mul(Fixed6 amount, UFixed6 total) private pure returns (Fixed6) {
        if (amount.sign() == -1) {
            return Fixed6Lib.from(
                -1,
                UFixed6.wrap(Math.ceilDiv(UFixed6.unwrap(amount.abs()) * UFixed6.unwrap(total), 1e6))
            );
        }
        return amount.mul(Fixed6Lib.from(total));
    }
}
