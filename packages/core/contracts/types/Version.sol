// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Fixed6 } from "@equilibria/root/number/types/Fixed6.sol";
import { Accumulator6 } from "@equilibria/root/accumulator/types/Accumulator6.sol";

/// @dev Version type
struct Version {
    /// @dev whether this version had a valid oracle price
    bool valid;

    /// @dev The price of the version
    Fixed6 price;

    /// @dev The maker accumulator value
    Accumulator6 makerValue;

    /// @dev The long accumulator value
    Accumulator6 longValue;

    /// @dev The short accumulator value
    Accumulator6 shortValue;

    /// @dev The accumulated fee for maker orders
    Accumulator6 makerFee;

    /// @dev The accumulated fee for taker orders
    Accumulator6 takerFee;

    /// @dev The accumulated offset for maker orders
    Accumulator6 makerOffset;

    /// @dev The accumulated offset for positive taker orders (open long / close short)
    Accumulator6 takerPosOffset;

    /// @dev The accumulated offset for negative taker orders (close long / open short)
    Accumulator6 takerNegOffset;

    /// @dev The accumulated settlement fee for each individual order
    Accumulator6 settlementFee;

    /// @dev The accumulated liquidation fee for each individual order
    Accumulator6 liquidationFee;
}
struct VersionStorage { uint256 slot0; uint256 slot1; uint256 slot2; }
using VersionStorageLib for VersionStorage global;

/// @dev Manually encodes and decodes the Version struct into storage.
///      (external-safe): this library is safe to externalize
///
///     struct StoredVersion {
///         /* slot 0 */
///         bool valid;
///         int64 makerValue;
///         int64 longValue;
///         int64 shortValue;
///         uint48 liquidationFee;
///
///         /* slot 1 */
///         int64 price;
///         int48 makerOffset;
///         int48 takerPosOffset;
///         int48 takerNegOffset;
///         uint48 settlementFee;
///
///         /* slot 2 */
///         int48 makerFee;
///         int48 takerFee;
///     }
///
library VersionStorageLib {
    // sig: 0xd2777e72
    error VersionStorageInvalidError();

    function read(VersionStorage storage self) internal view returns (Version memory) {
        (uint256 slot0, uint256 slot1, uint256 slot2) = (self.slot0, self.slot1, self.slot2);
        return Version(
            (uint256(slot0 << (256 - 8)) >> (256 - 8)) != 0,
            Fixed6.wrap(int256(slot1 << (256 - 64)) >> (256 - 64)),

            Accumulator6(Fixed6.wrap(int256(slot0 << (256 - 8 - 64)) >> (256 - 64))),
            Accumulator6(Fixed6.wrap(int256(slot0 << (256 - 8 - 64 - 64)) >> (256 - 64))),
            Accumulator6(Fixed6.wrap(int256(slot0 << (256 - 8 - 64 - 64 - 64)) >> (256 - 64))),

            Accumulator6(Fixed6.wrap(int256(slot2 << (256 - 48)) >> (256 - 48))),
            Accumulator6(Fixed6.wrap(int256(slot2 << (256 - 48 - 48)) >> (256 - 48))),

            Accumulator6(Fixed6.wrap(int256(slot1 << (256 - 64 - 48)) >> (256 - 48))),
            Accumulator6(Fixed6.wrap(int256(slot1 << (256 - 64 - 48 - 48)) >> (256 - 48))),
            Accumulator6(Fixed6.wrap(int256(slot1 << (256 - 64 - 48 - 48 - 48)) >> (256 - 48))),

            Accumulator6(Fixed6.wrap(int256(slot1 << (256 - 64 - 48 - 48 - 48 - 48)) >> (256 - 48))),
            Accumulator6(Fixed6.wrap(int256(slot0 << (256 - 8 - 64 - 64 - 64 - 48)) >> (256 - 48)))
        );
    }

    function store(VersionStorage storage self, Version memory newValue) external {
        if (newValue.price.gt(Fixed6.wrap(type(int64).max))) revert VersionStorageInvalidError();
        if (newValue.price.lt(Fixed6.wrap(type(int64).min))) revert VersionStorageInvalidError();
        if (newValue.makerValue._value.gt(Fixed6.wrap(type(int64).max))) revert VersionStorageInvalidError();
        if (newValue.makerValue._value.lt(Fixed6.wrap(type(int64).min))) revert VersionStorageInvalidError();
        if (newValue.longValue._value.gt(Fixed6.wrap(type(int64).max))) revert VersionStorageInvalidError();
        if (newValue.longValue._value.lt(Fixed6.wrap(type(int64).min))) revert VersionStorageInvalidError();
        if (newValue.shortValue._value.gt(Fixed6.wrap(type(int64).max))) revert VersionStorageInvalidError();
        if (newValue.shortValue._value.lt(Fixed6.wrap(type(int64).min))) revert VersionStorageInvalidError();
        if (newValue.makerFee._value.gt(Fixed6.wrap(type(int48).max))) revert VersionStorageInvalidError();
        if (newValue.makerFee._value.lt(Fixed6.wrap(type(int48).min))) revert VersionStorageInvalidError();
        if (newValue.takerFee._value.gt(Fixed6.wrap(type(int48).max))) revert VersionStorageInvalidError();
        if (newValue.takerFee._value.lt(Fixed6.wrap(type(int48).min))) revert VersionStorageInvalidError();
        if (newValue.makerOffset._value.gt(Fixed6.wrap(type(int48).max))) revert VersionStorageInvalidError();
        if (newValue.makerOffset._value.lt(Fixed6.wrap(type(int48).min))) revert VersionStorageInvalidError();
        if (newValue.takerPosOffset._value.gt(Fixed6.wrap(type(int48).max))) revert VersionStorageInvalidError();
        if (newValue.takerPosOffset._value.lt(Fixed6.wrap(type(int48).min))) revert VersionStorageInvalidError();
        if (newValue.takerNegOffset._value.gt(Fixed6.wrap(type(int48).max))) revert VersionStorageInvalidError();
        if (newValue.takerNegOffset._value.lt(Fixed6.wrap(type(int48).min))) revert VersionStorageInvalidError();
        if (newValue.settlementFee._value.gt(Fixed6.wrap(type(int48).max))) revert VersionStorageInvalidError();
        if (newValue.settlementFee._value.lt(Fixed6.wrap(type(int48).min))) revert VersionStorageInvalidError();
        if (newValue.liquidationFee._value.gt(Fixed6.wrap(type(int48).max))) revert VersionStorageInvalidError();
        if (newValue.liquidationFee._value.lt(Fixed6.wrap(type(int48).min))) revert VersionStorageInvalidError();

        uint256 encoded0 =
            uint256((newValue.valid ? uint256(1) : uint256(0)) << (256 - 8)) >> (256 - 8) |
            uint256(Fixed6.unwrap(newValue.makerValue._value) << (256 - 64)) >> (256 - 8 - 64) |
            uint256(Fixed6.unwrap(newValue.longValue._value) << (256 - 64)) >> (256 - 8 - 64 - 64) |
            uint256(Fixed6.unwrap(newValue.shortValue._value) << (256 - 64)) >> (256 - 8 - 64 - 64 - 64) |
            uint256(Fixed6.unwrap(newValue.liquidationFee._value) << (256 - 48)) >> (256 - 8 - 64 - 64 - 64 - 48);
        uint256 encoded1 =
            uint256(Fixed6.unwrap(newValue.price) << (256 - 64)) >> (256 - 64) |
            uint256(Fixed6.unwrap(newValue.makerOffset._value) << (256 - 48)) >> (256 - 64 - 48) |
            uint256(Fixed6.unwrap(newValue.takerPosOffset._value) << (256 - 48)) >> (256 - 64 - 48 - 48) |
            uint256(Fixed6.unwrap(newValue.takerNegOffset._value) << (256 - 48)) >> (256 - 64 - 48 - 48 - 48) |
            uint256(Fixed6.unwrap(newValue.settlementFee._value) << (256 - 48)) >> (256 - 64 - 48 - 48 - 48 - 48);
        uint256 encoded2 =
            uint256(Fixed6.unwrap(newValue.makerFee._value) << (256 - 48)) >> (256 - 48) |
            uint256(Fixed6.unwrap(newValue.takerFee._value) << (256 - 48)) >> (256 - 48 - 48);

        assembly {
            sstore(self.slot, encoded0)
            sstore(add(self.slot, 1), encoded1)
            sstore(add(self.slot, 2), encoded2)
        }
    }
}
