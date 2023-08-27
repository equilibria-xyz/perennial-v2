// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/Fixed6.sol";
import "./Position.sol";

/// @dev Invalidation type
struct Invalidation {
    /// @dev The change in the maker position
    Fixed6 maker;

    /// @dev The change in the long position
    Fixed6 long;

    /// @dev The change in the short position
    Fixed6 short;
}
using InvalidationLib for Invalidation global;

/// @title Invalidation
/// @notice Holds the state for an account's update invalidation
library InvalidationLib {
    // @notice Returns the invalidation delta between two positions
    function from(
        Position memory latestPosition,
        Position memory newPosition
    ) internal pure returns (Invalidation memory delta) {
        delta.maker = Fixed6Lib.from(latestPosition.maker).sub(Fixed6Lib.from(newPosition.maker));
        delta.long = Fixed6Lib.from(latestPosition.long).sub(Fixed6Lib.from(newPosition.long));
        delta.short = Fixed6Lib.from(latestPosition.short).sub(Fixed6Lib.from(newPosition.short));
    }

    // @notice Increments the invalidation accumulator by an invalidation delta
    function increment(Invalidation memory self, Invalidation memory delta) internal pure {
        self.maker = self.maker.add(delta.maker);
        self.long = self.long.add(delta.long);
        self.short = self.short.add(delta.short);
    }

    // @notice Returns the invalidation delta between two invalidation accumulators
    function sub(
        Invalidation memory self,
        Invalidation memory invalidation
    ) internal pure returns (Invalidation memory delta) {
        delta.maker = self.maker.sub(invalidation.maker);
        delta.long = self.long.sub(invalidation.long);
        delta.short = self.short.sub(invalidation.short);
    }
}
