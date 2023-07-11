// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/UFixed6.sol";

/// @dev ProtocolParameter type
struct ProtocolParameter {
    UFixed6 protocolFee;
    UFixed6 settlementFee; // TODO: move to oracle
    uint256 maxPendingIds;
}
struct StoredProtocolParameter {
    uint24 _protocolFee;        // <= 1677%
    uint24 _settlementFee;      // <= 1677%
    uint8 _maxPendingIds;       // <= 255

    bytes16 __unallocated__;
}
struct ProtocolParameterStorage { StoredProtocolParameter value; }
using ProtocolParameterStorageLib for ProtocolParameterStorage global;

library ProtocolParameterStorageLib {
    error ProtocolParameterStorageInvalidError();

    function read(ProtocolParameterStorage storage self) internal view returns (ProtocolParameter memory) {
        StoredProtocolParameter memory value = self.value;
        return ProtocolParameter(
            UFixed6.wrap(uint256(value._protocolFee)),
            UFixed6.wrap(uint256(value._settlementFee)),
            uint256(value._maxPendingIds)
        );
    }

    function store(ProtocolParameterStorage storage self, ProtocolParameter memory newValue) internal {
        if (newValue.protocolFee.gt(UFixed6.wrap(type(uint24).max))) revert ProtocolParameterStorageInvalidError();
        if (newValue.settlementFee.gt(UFixed6.wrap(type(uint24).max))) revert ProtocolParameterStorageInvalidError();
        if (newValue.maxPendingIds > uint256(type(uint8).max)) revert ProtocolParameterStorageInvalidError();

        self.value = StoredProtocolParameter(
            uint24(UFixed6.unwrap(newValue.protocolFee)),
            uint24(UFixed6.unwrap(newValue.settlementFee)),
            uint8(newValue.maxPendingIds),
            bytes10(0)
        );
    }
}