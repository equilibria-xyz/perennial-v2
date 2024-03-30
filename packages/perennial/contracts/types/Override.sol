// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/Fixed6.sol";
import "./Order.sol";

/// @dev Override type
struct Override {
    /// @dev The magnitude of the order applicable to the price override in the position direction
    UFixed6 magnitudePos;

    /// @dev The magnitude of the order applicable to the price override in the negative direction
    UFixed6 magnitudeNeg;

    /// @dev The price override in the position direction
    Fixed6 pricePos;

    /// @dev The price override in the negative direction
    Fixed6 priceNeg;
}
using OverrideLib for Override global;
struct OverrideStorage { uint256 slot0; }
using OverrideStorageLib for OverrideStorage global;

/// @title Override
/// @notice Holds the Override account state
library OverrideLib {
    /// @notice Updates the price override with the new order
    /// @param self The Override object to update
    /// @param newOrder The order to update the override with
    /// @param price The price override
    function update(Override memory self, Order memory newOrder, Fixed6 price) internal pure {
        self.magnitudePos = self.magnitudePos.add(newOrder.pos());
        self.magnitudeNeg = self.magnitudeNeg.add(newOrder.neg());
        self.pricePos = self.pricePos.add(price.mul(Fixed6Lib.from(newOrder.pos())));
        self.priceNeg = self.priceNeg.add(price.mul(Fixed6Lib.from(newOrder.neg())));
    }
}

/// @dev Manually encodes and decodes the Override struct into storage.
///
///     struct StoredOverride {
///         /* slot 0 */
///         uint64 magnitudePos;    // <= 18.44t
///         uint64 magnitudeNeg;    // <= 18.44t
///         int64 pricePos;         // <= 9.22t
///         int64 priceNeg;         // <= 9.22t
///     }
///
library OverrideStorageLib {
    // sig: 0xd57f5c05
    error OverrideStorageInvalidError();

    function read(OverrideStorage storage self) internal view returns (Override memory) {
        uint256 slot0 = self.slot0;
        return Override(
            UFixed6.wrap(uint256(slot0 << (256 - 64)) >> (256 - 64)),
            UFixed6.wrap(uint256(slot0 << (256 - 64 - 64)) >> (256 - 64)),
            Fixed6.wrap(int256(slot0 << (256 - 64 - 64 - 64)) >> (256 - 64)),
            Fixed6.wrap(int256(slot0 << (256 - 64 - 64 - 64 - 64)) >> (256 - 64))
        );
    }

    function store(OverrideStorage storage self, Override memory newValue) internal {
        if (newValue.magnitudePos.gt(UFixed6.wrap(type(uint64).max))) revert OverrideStorageInvalidError();
        if (newValue.magnitudeNeg.gt(UFixed6.wrap(type(uint64).max))) revert OverrideStorageInvalidError();
        if (newValue.pricePos.gt(Fixed6.wrap(type(int64).max))) revert OverrideStorageInvalidError();
        if (newValue.pricePos.lt(Fixed6.wrap(type(int64).min))) revert OverrideStorageInvalidError();
        if (newValue.priceNeg.gt(Fixed6.wrap(type(int64).max))) revert OverrideStorageInvalidError();
        if (newValue.priceNeg.lt(Fixed6.wrap(type(int64).min))) revert OverrideStorageInvalidError();

        uint256 encoded0 =
            uint256(UFixed6.unwrap(newValue.magnitudePos) << (256 - 64)) >> (256 - 64) |
            uint256(UFixed6.unwrap(newValue.magnitudeNeg) << (256 - 64)) >> (256 - 64 - 64) |
            uint256(Fixed6.unwrap(newValue.pricePos) << (256 - 64)) >> (256 - 64 - 64 - 64) |
            uint256(Fixed6.unwrap(newValue.priceNeg) << (256 - 64)) >> (256 - 64 - 64 - 64 - 64);

        assembly {
            sstore(self.slot, encoded0)
        }
    }
}