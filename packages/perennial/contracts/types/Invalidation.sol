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
    /// @notice Increments the invalidation accumulator by an invalidation delta
    /// @param self The invalidation object to update
    /// @param latestPosition The latest position
    /// @param newPosition The pending position
    function increment(Invalidation memory self, Position memory latestPosition, Position memory newPosition) internal pure {
        self.maker = self.maker.add(Fixed6Lib.from(latestPosition.maker).sub(Fixed6Lib.from(newPosition.maker)));
        self.long = self.long.add(Fixed6Lib.from(latestPosition.long).sub(Fixed6Lib.from(newPosition.long)));
        self.short = self.short.add(Fixed6Lib.from(latestPosition.short).sub(Fixed6Lib.from(newPosition.short)));
    }

    /// @notice Returns the invalidation delta between two invalidation accumulators
    /// @param self The starting invalidation object
    /// @param invalidation The ending invalidation object
    /// @return delta The invalidation delta
    function sub(
        Invalidation memory self,
        Invalidation memory invalidation
    ) internal pure returns (Invalidation memory delta) {
        delta.maker = self.maker.sub(invalidation.maker);
        delta.long = self.long.sub(invalidation.long);
        delta.short = self.short.sub(invalidation.short);
    }

    /// @notice Replaces the invalidation with a new invalidation
    /// @param self The invalidation object to update
    /// @param newInvalidation The new invalidation object
    function update(Invalidation memory self, Invalidation memory newInvalidation) internal pure {
        (self.maker, self.long, self.short) = (newInvalidation.maker, newInvalidation.long, newInvalidation.short);
    }
}
