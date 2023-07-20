// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/UFixed6.sol";

/// @dev VaultParameter type
struct VaultParameter {
    /// @dev The collateral cap of the vault
    UFixed6 cap;
}
struct StoredVaultParameter {
    uint64 _cap;
    bytes24 __unallocated__;
}
struct VaultParameterStorage { StoredVaultParameter value; }
using VaultParameterStorageLib for VaultParameterStorage global;

library VaultParameterStorageLib {
    error VaultParameterStorageInvalidError();

    function read(VaultParameterStorage storage self) internal view returns (VaultParameter memory) {
        StoredVaultParameter memory storedValue = self.value;

        return VaultParameter(
            UFixed6.wrap(uint256(storedValue._cap))
        );
    }

    function store(VaultParameterStorage storage self, VaultParameter memory newValue) internal {
        if (newValue.cap.gt(UFixed6.wrap(type(uint64).max))) revert VaultParameterStorageInvalidError();

        self.value = StoredVaultParameter(
            uint64(UFixed6.unwrap(newValue.cap)),
            bytes20(0)
        );
    }
}
