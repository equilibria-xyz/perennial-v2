// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Fixed6 } from "@equilibria/root/number/types/Fixed6.sol";
import { UFixed6 } from "@equilibria/root/number/types/UFixed6.sol";
import { Accumulator6 } from "@equilibria/root/accumulator/types/Accumulator6.sol";

/// @dev Version type
struct Version {
    /// @dev whether this version had a valid oracle price
    bool valid;

    /// @dev The price at the version
    Fixed6 price;

    /// @dev The exposure of open maker orders at the version
    Fixed6 makerPosExposure;

    /// @dev The exposure of close maker orders at the version
    Fixed6 makerNegExposure;

    /// @dev The exposure of open long orders at the version
    UFixed6 longPosExposure;

    /// @dev The exposure of close long orders at the version
    UFixed6 longNegExposure;

    /// @dev The exposure of open short orders at the version
    UFixed6 shortPosExposure;

    /// @dev The exposure of close short orders at the version
    UFixed6 shortNegExposure;

    /// @dev The maker accumulator value
    Accumulator6 makerValue;

    /// @dev The long accumulator value
    Accumulator6 longValue;

    /// @dev The short accumulator value
    Accumulator6 shortValue;

    /// @dev The maker spread accumulator value (recieves spread)
    Accumulator6 makerSpreadValue;

    /// @dev The long spread accumulator value (recieves spread during socialization)
    Accumulator6 longSpreadValue;

    /// @dev The short spread accumulator value (recieves spread during socialization)
    Accumulator6 shortSpreadValue;

    /// @dev The accumulated spread for positive taker or maker orders (open long / close short)
    Accumulator6 spreadPos;

    /// @dev The accumulated spread for negative  taker or maker orders (close long / open short)
    Accumulator6 spreadNeg;

    /// @dev The accumulated fee for maker orders
    Accumulator6 makerFee;

    /// @dev The accumulated fee for taker orders
    Accumulator6 takerFee;

    /// @dev The accumulated settlement fee for each individual order
    Accumulator6 settlementFee;

    /// @dev The accumulated liquidation fee for each individual order
    Accumulator6 liquidationFee;
}
struct VersionStorage { uint256 slot0; uint256 slot1; uint256 slot2; uint256 slot3; }
using VersionStorageLib for VersionStorage global;

/// @dev Manually encodes and decodes the Version struct into storage.
///      (external-safe): this library is safe to externalize
///
///     struct StoredVersion {
///         /* slot 0 */
///         bool valid;
///         int64 makerValue;   (must remain in place for backwards compatibility)
///         int64 longValue;    (must remain in place for backwards compatibility)
///         int64 shortValue;   (must remain in place for backwards compatibility)
///         uint48 liquidationFee;
///
///         /* slot 1 */
///         int64 price;
///         bytes6 __unallocated__;
///         int48 spreadPos;
///         int48 spreadNeg;
///         uint48 settlementFee;
///
///         /* slot 2 */
///         int48 makerFee;
///         int48 takerFee;
///         int48 makerSpreadValue; (must remain in place for backwards compatibility)
///         int48 longSpreadValue;  (must remain in place for backwards compatibility)
///         int48 shortSpreadValue; (must remain in place for backwards compatibility)
///
///         /* slot 3 */
///         int24 makerPosExposure;
///         int24 makerNegExposure;
///         uint24 longPosExposure;
///         uint24 longNegExposure;
///         uint24 shortPosExposure;
///         uint24 shortNegExposure;
///     }
///
library VersionStorageLib {
    // sig: 0xd2777e72
    error VersionStorageInvalidError();

    function read(VersionStorage storage self) internal view returns (Version memory) {
        (uint256 slot0, uint256 slot1, uint256 slot2, uint256 slot3) = (self.slot0, self.slot1, self.slot2, self.slot3);
        return Version(
            (uint256(slot0 << (256 - 8)) >> (256 - 8)) != 0,
            Fixed6.wrap(int256(slot1 << (256 - 64)) >> (256 - 64)),

            Fixed6.wrap(int256(slot3 << (256 - 24)) >> (256 - 24)),
            Fixed6.wrap(int256(slot3 << (256 - 24 - 24)) >> (256 - 24)),
            UFixed6.wrap(uint256(slot3 << (256 - 24 - 24 - 24)) >> (256 - 24)),
            UFixed6.wrap(uint256(slot3 << (256 - 24 - 24 - 24 - 24)) >> (256 - 24)),
            UFixed6.wrap(uint256(slot3 << (256 - 24 - 24 - 24 - 24 - 24)) >> (256 - 24)),
            UFixed6.wrap(uint256(slot3 << (256 - 24 - 24 - 24 - 24 - 24 - 24)) >> (256 - 24)),

            Accumulator6(Fixed6.wrap(int256(slot0 << (256 - 8 - 64)) >> (256 - 64))),
            Accumulator6(Fixed6.wrap(int256(slot0 << (256 - 8 - 64 - 64)) >> (256 - 64))),
            Accumulator6(Fixed6.wrap(int256(slot0 << (256 - 8 - 64 - 64 - 64)) >> (256 - 64))),

            Accumulator6(Fixed6.wrap(int256(slot2 << (256 - 48 - 48 - 48)) >> (256 - 48))),
            Accumulator6(Fixed6.wrap(int256(slot2 << (256 - 48 - 48 - 48 - 48)) >> (256 - 48))),
            Accumulator6(Fixed6.wrap(int256(slot2 << (256 - 48 - 48 - 48 - 48 - 48)) >> (256 - 48))),

            Accumulator6(Fixed6.wrap(int256(slot1 << (256 - 64 - 48 - 24 - 24)) >> (256 - 48))),
            Accumulator6(Fixed6.wrap(int256(slot1 << (256 - 64 - 48 - 24 - 24 - 48)) >> (256 - 48))),

            Accumulator6(Fixed6.wrap(int256(slot2 << (256 - 48)) >> (256 - 48))),
            Accumulator6(Fixed6.wrap(int256(slot2 << (256 - 48 - 48)) >> (256 - 48))),

            Accumulator6(Fixed6.wrap(int256(slot1 << (256 - 64 - 48 - 24 - 24 - 48 - 48)) >> (256 - 48))),
            Accumulator6(Fixed6.wrap(int256(slot0 << (256 - 8 - 64 - 64 - 64 - 48)) >> (256 - 48)))
        );
    }

    function store(VersionStorage storage self, Version memory newValue) external {
        if (newValue.price.gt(Fixed6.wrap(type(int64).max))) revert VersionStorageInvalidError();
        if (newValue.price.lt(Fixed6.wrap(type(int64).min))) revert VersionStorageInvalidError();
        if (newValue.makerPosExposure.gt(Fixed6.wrap(type(int24).max))) revert VersionStorageInvalidError();
        if (newValue.makerPosExposure.lt(Fixed6.wrap(type(int24).min))) revert VersionStorageInvalidError();
        if (newValue.makerNegExposure.gt(Fixed6.wrap(type(int24).max))) revert VersionStorageInvalidError();
        if (newValue.makerNegExposure.lt(Fixed6.wrap(type(int24).min))) revert VersionStorageInvalidError();
        if (newValue.longPosExposure.gt(UFixed6.wrap(type(uint24).max))) revert VersionStorageInvalidError();
        if (newValue.longPosExposure.lt(UFixed6.wrap(type(uint24).min))) revert VersionStorageInvalidError();
        if (newValue.longNegExposure.gt(UFixed6.wrap(type(uint24).max))) revert VersionStorageInvalidError();
        if (newValue.longNegExposure.lt(UFixed6.wrap(type(uint24).min))) revert VersionStorageInvalidError();
        if (newValue.shortPosExposure.gt(UFixed6.wrap(type(uint24).max))) revert VersionStorageInvalidError();
        if (newValue.shortPosExposure.lt(UFixed6.wrap(type(uint24).min))) revert VersionStorageInvalidError();
        if (newValue.shortNegExposure.gt(UFixed6.wrap(type(uint24).max))) revert VersionStorageInvalidError();
        if (newValue.shortNegExposure.lt(UFixed6.wrap(type(uint24).min))) revert VersionStorageInvalidError();
        if (newValue.makerValue._value.gt(Fixed6.wrap(type(int64).max))) revert VersionStorageInvalidError();
        if (newValue.makerValue._value.lt(Fixed6.wrap(type(int64).min))) revert VersionStorageInvalidError();
        if (newValue.longValue._value.gt(Fixed6.wrap(type(int64).max))) revert VersionStorageInvalidError();
        if (newValue.longValue._value.lt(Fixed6.wrap(type(int64).min))) revert VersionStorageInvalidError();
        if (newValue.shortValue._value.gt(Fixed6.wrap(type(int64).max))) revert VersionStorageInvalidError();
        if (newValue.shortValue._value.lt(Fixed6.wrap(type(int64).min))) revert VersionStorageInvalidError();
        if (newValue.makerSpreadValue._value.gt(Fixed6.wrap(type(int48).max))) revert VersionStorageInvalidError();
        if (newValue.makerSpreadValue._value.lt(Fixed6.wrap(type(int48).min))) revert VersionStorageInvalidError();
        if (newValue.longSpreadValue._value.gt(Fixed6.wrap(type(int48).max))) revert VersionStorageInvalidError();
        if (newValue.longSpreadValue._value.lt(Fixed6.wrap(type(int48).min))) revert VersionStorageInvalidError();
        if (newValue.shortSpreadValue._value.gt(Fixed6.wrap(type(int48).max))) revert VersionStorageInvalidError();
        if (newValue.shortSpreadValue._value.lt(Fixed6.wrap(type(int48).min))) revert VersionStorageInvalidError();
        if (newValue.spreadPos._value.gt(Fixed6.wrap(type(int48).max))) revert VersionStorageInvalidError();
        if (newValue.spreadPos._value.lt(Fixed6.wrap(type(int48).min))) revert VersionStorageInvalidError();
        if (newValue.spreadNeg._value.gt(Fixed6.wrap(type(int48).max))) revert VersionStorageInvalidError();
        if (newValue.spreadNeg._value.lt(Fixed6.wrap(type(int48).min))) revert VersionStorageInvalidError();
        if (newValue.makerFee._value.gt(Fixed6.wrap(type(int48).max))) revert VersionStorageInvalidError();
        if (newValue.makerFee._value.lt(Fixed6.wrap(type(int48).min))) revert VersionStorageInvalidError();
        if (newValue.takerFee._value.gt(Fixed6.wrap(type(int48).max))) revert VersionStorageInvalidError();
        if (newValue.takerFee._value.lt(Fixed6.wrap(type(int48).min))) revert VersionStorageInvalidError();
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
            uint256(Fixed6.unwrap(newValue.spreadPos._value) << (256 - 48)) >> (256 - 64 - 24 - 24 - 48) |
            uint256(Fixed6.unwrap(newValue.spreadNeg._value) << (256 - 48)) >> (256 - 64 - 24 - 24 - 48 - 48) |
            uint256(Fixed6.unwrap(newValue.settlementFee._value) << (256 - 48)) >> (256 - 64 - 24 - 24 - 48 - 48 - 48);
        uint256 encoded2 =
            uint256(Fixed6.unwrap(newValue.makerFee._value) << (256 - 48)) >> (256 - 48) |
            uint256(Fixed6.unwrap(newValue.takerFee._value) << (256 - 48)) >> (256 - 48 - 48) |
            uint256(Fixed6.unwrap(newValue.makerSpreadValue._value) << (256 - 48)) >> (256 - 48 - 48 - 48) |
            uint256(Fixed6.unwrap(newValue.longSpreadValue._value) << (256 - 48)) >> (256 - 48 - 48 - 48 - 48) |
            uint256(Fixed6.unwrap(newValue.shortSpreadValue._value) << (256 - 48)) >> (256 - 48 - 48 - 48 - 48 - 48);
        uint256 encoded3 =
            uint256(Fixed6.unwrap(newValue.makerPosExposure) << (256 - 24)) >> (256 - 24) |
            uint256(Fixed6.unwrap(newValue.makerNegExposure) << (256 - 24)) >> (256 - 24 - 24) |
            uint256(UFixed6.unwrap(newValue.longPosExposure) << (256 - 24)) >> (256 - 24 - 24 - 24) |
            uint256(UFixed6.unwrap(newValue.longNegExposure) << (256 - 24)) >> (256 - 24 - 24 - 24 - 24) |
            uint256(UFixed6.unwrap(newValue.shortPosExposure) << (256 - 24)) >> (256 - 24 - 24 - 24 - 24 - 24) |
            uint256(UFixed6.unwrap(newValue.shortNegExposure) << (256 - 24)) >> (256 - 24 - 24 - 24 - 24 - 24 - 24);

        assembly {
            sstore(self.slot, encoded0)
            sstore(add(self.slot, 1), encoded1)
            sstore(add(self.slot, 2), encoded2)
            sstore(add(self.slot, 3), encoded3)
        }
    }
}
