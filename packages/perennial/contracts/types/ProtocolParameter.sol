// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/UFixed6.sol";

/// @dev ProtocolParameter type
struct ProtocolParameter {
    UFixed6 protocolFee;
    UFixed6 liquidationFee;
    UFixed6 maxLiquidationFee;
    UFixed6 minCollateral;
    uint256 maxPendingIds;
    bool paused;
}
struct StoredProtocolParameter {
    uint24 _protocolFee;        // <= 1677%
    uint24 _liquidationFee;     // <= 1677%
    uint48 _maxLiquidationFee;  // <= 281mn
    uint48 _minCollateral;      // <= 281mn
    uint8 _maxPendingIds;       // <= 255
    bool _paused;

    bytes12 __unallocated__;
}
struct ProtocolParameterStorage { StoredProtocolParameter value; }
using ProtocolParameterStorageLib for ProtocolParameterStorage global;

library ProtocolParameterStorageLib {
    error ProtocolParameterStorageInvalidError();

    function read(ProtocolParameterStorage storage self) internal view returns (ProtocolParameter memory) {
        StoredProtocolParameter memory value = self.value;
        return ProtocolParameter(
            UFixed6.wrap(uint256(value._protocolFee)),
            UFixed6.wrap(uint256(value._liquidationFee)),
            UFixed6.wrap(uint256(value._maxLiquidationFee)),
            UFixed6.wrap(uint256(value._minCollateral)),
            uint256(value._maxPendingIds),
            value._paused
        );
    }

    function store(ProtocolParameterStorage storage self, ProtocolParameter memory newValue) internal {
        if (newValue.protocolFee.gt(UFixed6.wrap(type(uint24).max))) revert ProtocolParameterStorageInvalidError();
        if (newValue.liquidationFee.gt(UFixed6.wrap(type(uint24).max))) revert ProtocolParameterStorageInvalidError();
        if (newValue.maxLiquidationFee.gt(UFixed6.wrap(type(uint48).max))) revert ProtocolParameterStorageInvalidError();
        if (newValue.minCollateral.gt(UFixed6.wrap(type(uint48).max))) revert ProtocolParameterStorageInvalidError();
        if (newValue.maxPendingIds > uint256(type(uint8).max)) revert ProtocolParameterStorageInvalidError();

        self.value = StoredProtocolParameter(
            uint24(UFixed6.unwrap(newValue.protocolFee)),
            uint24(UFixed6.unwrap(newValue.liquidationFee)),
            uint48(UFixed6.unwrap(newValue.maxLiquidationFee)),
            uint48(UFixed6.unwrap(newValue.minCollateral)),
            uint8(newValue.maxPendingIds),
            newValue.paused,
            bytes12(0)
        );
    }
}