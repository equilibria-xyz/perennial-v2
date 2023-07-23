// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/perennial-v2/contracts/interfaces/IMarket.sol";
import "@equilibria/root/number/types/UFixed6.sol";

/// @dev Registration type
struct Registration {
    /// @dev The underlying market
    IMarket market;

    /// @dev The weight of the market
    uint256 weight;

    /// @dev The leverage of the market
    UFixed6 leverage;
}
struct StoredRegistration {
    /* slot 0 */
    address market;
    uint32 weight;          // <= 4.29b
    uint32 leverage;        // <= 4290x
    bytes4 __unallocated0__;
}
struct RegistrationStorage { StoredRegistration value; }
using RegistrationStorageLib for RegistrationStorage global;

library RegistrationStorageLib {
    error RegistrationStorageInvalidError();

    function read(RegistrationStorage storage self) internal view returns (Registration memory) {
        StoredRegistration memory storedValue = self.value;
        return Registration(
            IMarket(storedValue.market),
            uint256(storedValue.weight),
            UFixed6.wrap(uint256(storedValue.leverage))
        );
    }

    function store(RegistrationStorage storage self, Registration memory newValue) internal {
        if (newValue.weight > uint256(type(uint32).max)) revert RegistrationStorageInvalidError();
        if (newValue.leverage.gt(UFixed6.wrap(type(uint32).max))) revert RegistrationStorageInvalidError();

        self.value = StoredRegistration(
            address(newValue.market),
            uint32(newValue.weight),
            uint32(UFixed6.unwrap(newValue.leverage)),
            bytes4(0)
        );
    }
}
