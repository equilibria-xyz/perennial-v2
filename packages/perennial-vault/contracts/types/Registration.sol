// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/perennial-v2/contracts/interfaces/IMarket.sol";
import "@equilibria/root/number/types/UFixed6.sol";
import "./Checkpoint.sol";

/// @dev Registration type
struct Registration {
    IMarket market;
    uint256 initialId;
    uint256 weight;
}
using RegistrationLib for Registration global;
struct StoredRegistration {
    address _market;
    uint32 _initialId;
    uint64 _weight;
}
struct RegistrationStorage { StoredRegistration value; }
using RegistrationStorageLib for RegistrationStorage global;

/**
 * @title RegistrationLib
 * @notice
 */
library RegistrationLib {

}

library RegistrationStorageLib {
    error RegistrationStorageInvalidError();

    function read(RegistrationStorage storage self) internal view returns (Registration memory) {
        StoredRegistration memory storedValue = self.value;
        return Registration(
            IMarket(storedValue._market),
            uint256(storedValue._initialId),
            uint256(storedValue._weight)
        );
    }

    function store(RegistrationStorage storage self, Registration memory newValue) internal {
        if (newValue.initialId > uint256(type(uint32).max)) revert RegistrationStorageInvalidError();
        if (newValue.weight > uint256(type(uint64).max)) revert RegistrationStorageInvalidError();

        self.value = StoredRegistration(
            address(newValue.market),
            uint32(newValue.initialId),
            uint64(newValue.weight)
        );
    }
}
