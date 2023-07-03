// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/token/types/Token18.sol";
import "@equilibria/root/number/types/UFixed6.sol";
import "./Checkpoint.sol";

/// @dev VaultParameter type
struct VaultParameter {
    UFixed6 leverage;
    UFixed6 cap;
    UFixed6 premium;
}
struct StoredVaultParameter {
    uint32 _leverage;
    uint64 _cap;
    uint24 _premium;
    bytes17 __unallocated__;
}
struct VaultParameterStorage { StoredVaultParameter value; }
using VaultParameterStorageLib for VaultParameterStorage global;

library VaultParameterStorageLib {
    error VaultParameterStorageInvalidError();

    function read(VaultParameterStorage storage self) internal view returns (VaultParameter memory) {
        StoredVaultParameter memory storedValue = self.value;

        return VaultParameter(
            UFixed6.wrap(uint256(storedValue._leverage)),
            UFixed6.wrap(uint256(storedValue._cap)),
            UFixed6.wrap(uint256(storedValue._premium))
        );
    }

    function store(VaultParameterStorage storage self, VaultParameter memory newValue) internal {
        if (newValue.leverage.gt(UFixed6.wrap(type(uint32).max))) revert VaultParameterStorageInvalidError();
        if (newValue.cap.gt(UFixed6.wrap(type(uint64).max))) revert VaultParameterStorageInvalidError();
        if (newValue.premium.gt(UFixed6.wrap(type(uint24).max))) revert VaultParameterStorageInvalidError();

        self.value = StoredVaultParameter(
            uint32(UFixed6.unwrap(newValue.leverage)),
            uint64(UFixed6.unwrap(newValue.cap)),
            uint24(UFixed6.unwrap(newValue.premium)),
            bytes17(0)
        );
    }
}
