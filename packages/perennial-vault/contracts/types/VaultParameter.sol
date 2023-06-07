// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/perennial-v2/contracts/interfaces/IFactory.sol";
import "@equilibria/root/number/types/UFixed6.sol";
import "./Checkpoint.sol";

/// @dev VaultParameter type
struct VaultParameter {
    Token18 asset;
    UFixed6 leverage;
    UFixed6 cap;
    UFixed6 premium;
}
struct StoredVaultParameter {
    // slot 1
    address _asset;
    uint32 _leverage;
    uint32 _cap;
    uint24 _premium;
    bool _fuse;
}
struct VaultParameterStorage { StoredVaultParameter value; }
using VaultParameterStorageLib for VaultParameterStorage global;

library VaultParameterStorageLib {
    error VaultParameterStorageInvalidError();
    error VaultParameterStorageImmutableError();

    function read(VaultParameterStorage storage self) internal view returns (VaultParameter memory) {
        StoredVaultParameter memory storedValue = self.value;
        return VaultParameter(
            Token18.wrap(storedValue._asset),
            UFixed6.wrap(uint256(storedValue._leverage)),
            UFixed6.wrap(uint256(storedValue._cap) * 1000e6),
            UFixed6.wrap(uint256(storedValue._premium))
        );
    }

    function store(VaultParameterStorage storage self, VaultParameter memory newValue) internal {
        StoredVaultParameter memory oldValue = self.value;

        if (newValue.leverage.gt(UFixed6.wrap(type(uint32).max))) revert VaultParameterStorageInvalidError();
        if (UFixed6.unwrap(newValue.cap) > uint256(type(uint32).max) * 1000e6) revert VaultParameterStorageInvalidError();
        if (newValue.premium.gt(UFixed6.wrap(type(uint24).max))) revert VaultParameterStorageInvalidError();

        if (oldValue._fuse && oldValue._asset != Token18.unwrap(newValue.asset)) revert VaultParameterStorageImmutableError();

        self.value = StoredVaultParameter(
            Token18.unwrap(newValue.asset),
            uint32(UFixed6.unwrap(newValue.leverage)),
            uint32(UFixed6.unwrap(newValue.cap) / 1000e6),
            uint24(UFixed6.unwrap(newValue.premium)),
            true
        );
    }
}
