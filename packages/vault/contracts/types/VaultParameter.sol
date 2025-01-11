// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";

/// @dev VaultParameter type
struct VaultParameter {
    /// @dev The maximum total that can be deposited into the vault
    UFixed6 maxDeposit;

    /// @dev The minimum amount that can be deposited into the vault at one time
    UFixed6 minDeposit;

    /// @dev The profit share percentage with the coordinator
    UFixed6 profitShare;
}
struct StoredVaultParameter {
    /* slot 0 */
    uint64 maxDeposit;
    uint64 minDeposit;
    uint24 profitShare;
    bytes13 __unallocated0__;
}
struct VaultParameterStorage { StoredVaultParameter value; } // SECURITY: must remain at (1) slots
using VaultParameterStorageLib for VaultParameterStorage global;

/// @dev (external-safe): this library is safe to externalize
library VaultParameterStorageLib {
    // sig: 0x0f9f8b19
    error VaultParameterStorageInvalidError();

    function read(VaultParameterStorage storage self) internal view returns (VaultParameter memory) {
        StoredVaultParameter memory storedValue = self.value;

        return VaultParameter(
            UFixed6.wrap(uint256(storedValue.maxDeposit)),
            UFixed6.wrap(uint256(storedValue.minDeposit)),
            UFixed6.wrap(uint256(storedValue.profitShare))

        );
    }

    function store(VaultParameterStorage storage self, VaultParameter memory newValue) internal {
        if (newValue.maxDeposit.gt(UFixed6.wrap(type(uint64).max))) revert VaultParameterStorageInvalidError();
        if (newValue.minDeposit.gt(UFixed6.wrap(type(uint64).max))) revert VaultParameterStorageInvalidError();
        if (newValue.profitShare.gt(UFixed6Lib.ONE)) revert VaultParameterStorageInvalidError();

        self.value = StoredVaultParameter(
            uint64(UFixed6.unwrap(newValue.maxDeposit)),
            uint64(UFixed6.unwrap(newValue.minDeposit)),
            uint24(UFixed6.unwrap(newValue.profitShare)),
            bytes13(0)
        );
    }
}
