// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/UFixed6.sol";

/// @dev ProtocolParameter type
struct ProtocolParameter {
    uint256 maxPendingIds;
    UFixed6 protocolFee;
    UFixed6 maxFee;
    UFixed6 maxFeeAbsolute;
    UFixed6 maxCut;
    UFixed6 maxRate;
    UFixed6 minMaintenance;
    UFixed6 minEfficiency;
}
struct StoredProtocolParameter {
    uint8 _maxPendingIds;       // <= 255
    uint24 _protocolFee;        // <= 1677%
    uint24 _maxFee;             // <= 1677%
    uint48 _maxFeeAbsolute;     // <= 281m
    uint24 _maxCut;             // <= 1677%
    uint32 _maxRate;            // <= 429496%
    uint24 _minMaintenance;     // <= 1677%
    uint24 _minEfficiency;      // <= 1677%
}
struct ProtocolParameterStorage { StoredProtocolParameter value; }
using ProtocolParameterStorageLib for ProtocolParameterStorage global;

library ProtocolParameterStorageLib {
    error ProtocolParameterStorageInvalidError();

    function read(ProtocolParameterStorage storage self) internal view returns (ProtocolParameter memory) {
        StoredProtocolParameter memory value = self.value;
        return ProtocolParameter(
            uint256(value._maxPendingIds),
            UFixed6.wrap(uint256(value._protocolFee)),
            UFixed6.wrap(uint256(value._maxFee)),
            UFixed6.wrap(uint256(value._maxFeeAbsolute)),
            UFixed6.wrap(uint256(value._maxCut)),
            UFixed6.wrap(uint256(value._maxRate)),
            UFixed6.wrap(uint256(value._minMaintenance)),
            UFixed6.wrap(uint256(value._minEfficiency))
        );
    }

    function store(ProtocolParameterStorage storage self, ProtocolParameter memory newValue) internal {
        if (newValue.maxPendingIds > uint256(type(uint8).max)) revert ProtocolParameterStorageInvalidError();
        if (newValue.protocolFee.gt(UFixed6.wrap(type(uint24).max))) revert ProtocolParameterStorageInvalidError();
        if (newValue.maxFee.gt(UFixed6.wrap(type(uint24).max))) revert ProtocolParameterStorageInvalidError();
        if (newValue.maxFeeAbsolute.gt(UFixed6.wrap(type(uint48).max))) revert ProtocolParameterStorageInvalidError();
        if (newValue.maxCut.gt(UFixed6.wrap(type(uint24).max))) revert ProtocolParameterStorageInvalidError();
        if (newValue.maxRate.gt(UFixed6.wrap(type(uint32).max))) revert ProtocolParameterStorageInvalidError();
        if (newValue.minMaintenance.gt(UFixed6.wrap(type(uint24).max))) revert ProtocolParameterStorageInvalidError();
        if (newValue.minEfficiency.gt(UFixed6.wrap(type(uint24).max))) revert ProtocolParameterStorageInvalidError();

        self.value = StoredProtocolParameter(
            uint8(newValue.maxPendingIds),
            uint24(UFixed6.unwrap(newValue.protocolFee)),
            uint24(UFixed6.unwrap(newValue.maxFee)),
            uint48(UFixed6.unwrap(newValue.maxFeeAbsolute)),
            uint24(UFixed6.unwrap(newValue.maxCut)),
            uint32(UFixed6.unwrap(newValue.maxRate)),
            uint24(UFixed6.unwrap(newValue.minMaintenance)),
            uint24(UFixed6.unwrap(newValue.minEfficiency))
        );
    }
}