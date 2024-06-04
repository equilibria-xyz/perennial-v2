// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/accumulator/types/Accumulator6.sol";
import "./ProtocolParameter.sol";
import "./MarketParameter.sol";
import "./RiskParameter.sol";
import "./Global.sol";
import "./Position.sol";
import "./Order.sol";

/// @dev Version type
struct Version {
    /// @dev whether this version had a valid oracle price
    bool valid;

    /// @dev The maker accumulator value
    Accumulator6 makerValue;

    /// @dev The long accumulator value
    Accumulator6 longValue;

    /// @dev The short accumulator value
    Accumulator6 shortValue;

    /// @dev The accumulated linear fee for maker orders
    Accumulator6 makerLinearFee;

    /// @dev The accumulated proportional fee for maker orders
    Accumulator6 makerProportionalFee;

    /// @dev The accumulated linear fee for taker orders
    Accumulator6 takerLinearFee;

    /// @dev The accumulated proportional fee for taker orders
    Accumulator6 takerProportionalFee;

    /// @dev The accumulated fee for positive skew maker orders
    Accumulator6 makerPosFee;

    /// @dev The accumulated fee for negative skew maker orders
    Accumulator6 makerNegFee;

    /// @dev The accumulated fee for positive skew taker orders
    Accumulator6 takerPosFee;

    /// @dev The accumulated fee for negative skew taker orders
    Accumulator6 takerNegFee;

    /// @dev The accumulated settlement fee for each individual order
    Accumulator6 settlementFee;

    /// @dev The accumulated liquidation fee for each individual order
    Accumulator6 liquidationFee;
}
struct VersionStorage { uint256 slot0; uint256 slot1; uint256 slot2; }
using VersionStorageLib for VersionStorage global;

/// @dev Manually encodes and decodes the Version struct into storage.
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
///         int48 makerPosFee;
///         int48 makerNegFee;
///         int48 takerPosFee;
///         int48 takerNegFee;
///         uint48 settlementFee;
///
///         /* slot 2 */
///         int48 makerLinearFee;
///         int48 makerProportionalFee;
///         int48 takerLinearFee;
///         int48 takerProportionalFee;
///     }
///
library VersionStorageLib {
    // sig: 0xd2777e72
    error VersionStorageInvalidError();

    function read(VersionStorage storage self) internal view returns (Version memory) {
        (uint256 slot0, uint256 slot1, uint256 slot2) = (self.slot0, self.slot1, self.slot2);
        return Version(
            (uint256(slot0 << (256 - 8)) >> (256 - 8)) != 0,
            Accumulator6(Fixed6.wrap(int256(slot0 << (256 - 8 - 64)) >> (256 - 64))),
            Accumulator6(Fixed6.wrap(int256(slot0 << (256 - 8 - 64 - 64)) >> (256 - 64))),
            Accumulator6(Fixed6.wrap(int256(slot0 << (256 - 8 - 64 - 64 - 64)) >> (256 - 64))),

            Accumulator6(Fixed6.wrap(int256(slot2 << (256 - 48)) >> (256 - 48))),
            Accumulator6(Fixed6.wrap(int256(slot2 << (256 - 48 - 48)) >> (256 - 48))),
            Accumulator6(Fixed6.wrap(int256(slot2 << (256 - 48 - 48 - 48)) >> (256 - 48))),
            Accumulator6(Fixed6.wrap(int256(slot2 << (256 - 48 - 48 - 48 - 48)) >> (256 - 48))),

            Accumulator6(Fixed6.wrap(int256(slot1 << (256 - 48)) >> (256 - 48))),
            Accumulator6(Fixed6.wrap(int256(slot1 << (256 - 48 - 48)) >> (256 - 48))),
            Accumulator6(Fixed6.wrap(int256(slot1 << (256 - 48 - 48 - 48)) >> (256 - 48))),
            Accumulator6(Fixed6.wrap(int256(slot1 << (256 - 48 - 48 - 48 - 48)) >> (256 - 48))),

            Accumulator6(Fixed6.wrap(int256(slot1 << (256 - 48 - 48 - 48 - 48 - 48)) >> (256 - 48))),
            Accumulator6(Fixed6.wrap(int256(slot0 << (256 - 8 - 64 - 64 - 64 - 48)) >> (256 - 48)))
        );
    }

    function store(VersionStorage storage self, Version memory newValue) external {
        if (newValue.makerValue._value.gt(Fixed6.wrap(type(int64).max))) revert VersionStorageInvalidError();
        if (newValue.makerValue._value.lt(Fixed6.wrap(type(int64).min))) revert VersionStorageInvalidError();
        if (newValue.longValue._value.gt(Fixed6.wrap(type(int64).max))) revert VersionStorageInvalidError();
        if (newValue.longValue._value.lt(Fixed6.wrap(type(int64).min))) revert VersionStorageInvalidError();
        if (newValue.shortValue._value.gt(Fixed6.wrap(type(int64).max))) revert VersionStorageInvalidError();
        if (newValue.shortValue._value.lt(Fixed6.wrap(type(int64).min))) revert VersionStorageInvalidError();
        if (newValue.makerLinearFee._value.gt(Fixed6.wrap(type(int48).max))) revert VersionStorageInvalidError();
        if (newValue.makerLinearFee._value.lt(Fixed6.wrap(type(int48).min))) revert VersionStorageInvalidError();
        if (newValue.makerProportionalFee._value.gt(Fixed6.wrap(type(int48).max))) revert VersionStorageInvalidError();
        if (newValue.makerProportionalFee._value.lt(Fixed6.wrap(type(int48).min))) revert VersionStorageInvalidError();
        if (newValue.takerLinearFee._value.gt(Fixed6.wrap(type(int48).max))) revert VersionStorageInvalidError();
        if (newValue.takerLinearFee._value.lt(Fixed6.wrap(type(int48).min))) revert VersionStorageInvalidError();
        if (newValue.takerProportionalFee._value.gt(Fixed6.wrap(type(int48).max))) revert VersionStorageInvalidError();
        if (newValue.takerProportionalFee._value.lt(Fixed6.wrap(type(int48).min))) revert VersionStorageInvalidError();
        if (newValue.makerPosFee._value.gt(Fixed6.wrap(type(int48).max))) revert VersionStorageInvalidError();
        if (newValue.makerPosFee._value.lt(Fixed6.wrap(type(int48).min))) revert VersionStorageInvalidError();
        if (newValue.makerNegFee._value.gt(Fixed6.wrap(type(int48).max))) revert VersionStorageInvalidError();
        if (newValue.makerNegFee._value.lt(Fixed6.wrap(type(int48).min))) revert VersionStorageInvalidError();
        if (newValue.takerPosFee._value.gt(Fixed6.wrap(type(int48).max))) revert VersionStorageInvalidError();
        if (newValue.takerPosFee._value.lt(Fixed6.wrap(type(int48).min))) revert VersionStorageInvalidError();
        if (newValue.takerNegFee._value.gt(Fixed6.wrap(type(int48).max))) revert VersionStorageInvalidError();
        if (newValue.takerNegFee._value.lt(Fixed6.wrap(type(int48).min))) revert VersionStorageInvalidError();
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
            uint256(Fixed6.unwrap(newValue.makerPosFee._value) << (256 - 48)) >> (256 - 48) |
            uint256(Fixed6.unwrap(newValue.makerNegFee._value) << (256 - 48)) >> (256 - 48 - 48) |
            uint256(Fixed6.unwrap(newValue.takerPosFee._value) << (256 - 48)) >> (256 - 48 - 48 - 48) |
            uint256(Fixed6.unwrap(newValue.takerNegFee._value) << (256 - 48)) >> (256 - 48 - 48 - 48 - 48) |
            uint256(Fixed6.unwrap(newValue.settlementFee._value) << (256 - 48)) >> (256 - 48 - 48 - 48 - 48 - 48);
        uint256 encoded2 =
            uint256(Fixed6.unwrap(newValue.makerLinearFee._value) << (256 - 48)) >> (256 - 48) |
            uint256(Fixed6.unwrap(newValue.makerProportionalFee._value) << (256 - 48)) >> (256 - 48 - 48) |
            uint256(Fixed6.unwrap(newValue.takerLinearFee._value) << (256 - 48)) >> (256 - 48 - 48 - 48) |
            uint256(Fixed6.unwrap(newValue.takerProportionalFee._value) << (256 - 48)) >> (256 - 48 - 48 - 48 - 48);

        assembly {
            sstore(self.slot, encoded0)
            sstore(add(self.slot, 1), encoded1)
            sstore(add(self.slot, 2), encoded2)
        }
    }
}
