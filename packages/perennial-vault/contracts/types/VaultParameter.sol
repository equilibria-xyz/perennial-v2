// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root-v2/contracts/UFixed6.sol";
import "./Checkpoint.sol";

/// @dev VaultParameter type
struct VaultParameter {
    uint256 totalMarkets;
    uint256 totalWeight;
    uint256 minWeight;
    UFixed6 leverage;
    UFixed6 cap;
}
struct StoredVaultParameter {
    uint8 _totalMarkets;
    uint32 _totalWeight;
    uint32 _minWeight;
    uint32 _leverage;
    uint64 _cap;
    bytes11 __unallocated__;
}
struct VaultParameterStorage { StoredVaultParameter value; }
using VaultParameterStorageLib for VaultParameterStorage global;

library VaultParameterStorageLib {
    error VaultParameterStorageInvalidError();

    function read(VaultParameterStorage storage self) internal view returns (VaultParameter memory) {
        StoredVaultParameter memory storedValue = self.value;
        return VaultParameter(
            uint256(storedValue._totalMarkets),
            uint256(storedValue._totalWeight),
            uint256(storedValue._minWeight),
            UFixed6.wrap(uint256(storedValue._leverage)),
            UFixed6.wrap(uint256(storedValue._cap))
        );
    }

    function store(VaultParameterStorage storage self, VaultParameter memory newValue) internal {
        if (newValue.totalMarkets > type(uint8).max) revert VaultParameterStorageInvalidError();
        if (newValue.totalWeight > type(uint32).max) revert VaultParameterStorageInvalidError();
        if (newValue.minWeight > type(uint32).max) revert VaultParameterStorageInvalidError();
        if (newValue.leverage.gt(UFixed6Lib.MAX_32)) revert VaultParameterStorageInvalidError();
        if (newValue.cap.gt(UFixed6Lib.MAX_64)) revert VaultParameterStorageInvalidError();

        self.value = StoredVaultParameter(
            uint8(newValue.totalMarkets),
            uint32(newValue.totalWeight),
            uint32(newValue.minWeight),
            uint32(UFixed6.unwrap(newValue.leverage)),
            uint64(UFixed6.unwrap(newValue.cap)),
            bytes11(0)
        );
    }
}
