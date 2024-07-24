// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Fixed6 } from "@equilibria/root/number/types/UFixed6.sol";

struct TriggerOrder {
    uint8 side;      // 0 = maker, 1 = long, 2 = short
    int8 comparison; // -2 = lt, -1 = lte, 0 = eq, 1 = gte, 2 = gt
    Fixed6 price;    // <= 9.22t
    Fixed6 delta;    // <= 9.22t
}
// TODO: create lib for processing trigger order logic
// TODO: move message verification stuff here, because it doesn't involve storage
// using TriggerOrderLib for TriggerOrder global;

struct StoredTriggerOrder {
    /* slot 0 */
    uint8 side;      // 0 = maker, 1 = long, 2 = short
    int8 comparison; // -2 = lt, -1 = lte, 0 = eq, 1 = gte, 2 = gt
    int64 price;     // <= 9.22t
    int64 delta;     // <= 9.22t
}
struct TriggerOrderStorage { StoredTriggerOrder value; /*uint256 slot0;*/ }
using TriggerOrderStorageLib for TriggerOrderStorage global;

// TODO: What makes this "external-safe"?
/// @dev Manually encodes and decodes the TriggerOrder struct to/from storage, 
///      and provides facility for hashing for inclusion in EIP-712 messages 
library TriggerOrderStorageLib {
    /// @dev Used to verify a signed message
    bytes32 constant public STRUCT_HASH = keccak256(
        "TriggerOrder(uint8 side,int8 comparison,uint256 price,uint256 delta)"
    );

    // sig: 0xf3469aa7
    error TriggerOrderStorageInvalidError();

    /// @dev reads a trigger order struct from storage
    function read(TriggerOrderStorage storage self) internal view returns (TriggerOrder memory) {
        StoredTriggerOrder memory storedValue = self.value;
        return TriggerOrder(
            uint8(storedValue.side),
            int8(storedValue.comparison),
            Fixed6.wrap(int256(storedValue.price)),
            Fixed6.wrap(int256(storedValue.delta))
        );
    }

    /// @dev writes a trigger order struct to storage
    function store(TriggerOrderStorage storage self, TriggerOrder memory newValue) internal {
        if (newValue.side > type(uint8).max) revert TriggerOrderStorageInvalidError();
        if (newValue.comparison > type(int8).max) revert TriggerOrderStorageInvalidError();
        if (newValue.comparison < type(int8).min) revert TriggerOrderStorageInvalidError();
        if (newValue.price.gt(Fixed6.wrap(type(int64).max))) revert TriggerOrderStorageInvalidError();
        if (newValue.price.lt(Fixed6.wrap(type(int64).min))) revert TriggerOrderStorageInvalidError();
        if (newValue.delta.gt(Fixed6.wrap(type(int64).max))) revert TriggerOrderStorageInvalidError();
        if (newValue.delta.lt(Fixed6.wrap(type(int64).min))) revert TriggerOrderStorageInvalidError();

        self.value = StoredTriggerOrder(
            uint8(newValue.side),
            int8(newValue.comparison),
            int64(Fixed6.unwrap(newValue.price)),
            int64(Fixed6.unwrap(newValue.delta))
        );
    }

    /// @dev Used to create a signed message
    function hash(TriggerOrder memory self) internal pure returns (bytes32) {
        return keccak256(abi.encode(STRUCT_HASH, self.side, self.comparison, self.price, self.delta));
    }
}
