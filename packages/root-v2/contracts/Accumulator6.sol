// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "./Fixed6.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

/// @dev Accumulator6 type
struct Accumulator6 {
    Fixed6 _value;
}
using Accumulator6Lib for Accumulator6 global;

/**
 * @title Accumulator6Lib
 * @notice
 * @dev
 */
library Accumulator6Lib {
    function accumulated(Accumulator6 memory self, Accumulator6 memory from, UFixed6 total) internal pure returns (Fixed6) {
        return _mul(self._value.sub(from._value), total);
    }

    function increment(Accumulator6 memory self, Fixed6 amount, UFixed6 total) internal pure {
        self._value = self._value.add(_div(amount, total));
    }

    function decrement(Accumulator6 memory self, Fixed6 amount, UFixed6 total) internal pure {
        self._value = self._value.add(_div(amount.mul(Fixed6Lib.NEG_ONE), total));
    }

    function _div(Fixed6 amount, UFixed6 total) private pure returns (Fixed6) {
        if (amount.sign() == -1) {
            return Fixed6Lib.from(
                -1,
                UFixed6.wrap(Math.ceilDiv(UFixed6.unwrap(amount.abs()) * 1e6, UFixed6.unwrap(total)))
            );
        }
        return amount.div(Fixed6Lib.from(total));
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
