// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "./ProtocolParameter.sol";

/// @dev Global type
struct Global {
    uint256 currentId;
    UFixed6 protocolFee;
    UFixed6 marketFee;
}
using GlobalLib for Global global;
struct StoredGlobal {
    uint64 _currentId;
    uint64 _protocolFee;
    uint64 _marketFee;
    bytes8 __unallocated__;
}
struct GlobalStorage { StoredGlobal value; }
using GlobalStorageLib for GlobalStorage global;

/**
 * @title GlobalLib
 * @notice
 */
library GlobalLib {
    function incrementFees(Global memory self, UFixed6 amount, ProtocolParameter memory protocolParameter) internal pure {
        UFixed6 protocolAmount = amount.mul(protocolParameter.protocolFee);
        UFixed6 marketAmount = amount.sub(protocolAmount);
        self.protocolFee = self.protocolFee.add(protocolAmount);
        self.marketFee = self.marketFee.add(marketAmount);
    }
}

library GlobalStorageLib {
    error GlobalStorageInvalidError();

    function read(GlobalStorage storage self) internal view returns (Global memory) {
        StoredGlobal memory storedValue = self.value;
        return Global(
            uint256(storedValue._currentId),
            UFixed6.wrap(uint256(storedValue._protocolFee)),
            UFixed6.wrap(uint256(storedValue._marketFee))
        );
    }

    function store(GlobalStorage storage self, Global memory newValue) internal {
        if (newValue.currentId > uint256(type(uint64).max)) revert GlobalStorageInvalidError();
        if (newValue.protocolFee.gt(UFixed6.wrap(type(uint64).max))) revert GlobalStorageInvalidError();
        if (newValue.marketFee.gt(UFixed6.wrap(type(uint64).max))) revert GlobalStorageInvalidError();

        self.value = StoredGlobal(
            uint64(newValue.currentId),
            uint64(UFixed6.unwrap(newValue.protocolFee)),
            uint64(UFixed6.unwrap(newValue.marketFee)),
            bytes8(0)
        );
    }
}
