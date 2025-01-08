// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { IMarket } from "@perennial/v2-core/contracts/interfaces/IMarket.sol";
import { UFixed6 } from "@equilibria/root/number/types/UFixed6.sol";

/// @dev Registration type
struct Registration {
    /// @dev The underlying market
    IMarket market;

    /// @dev The weight of the market
    UFixed6 weight;

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

/// @dev (external-safe): this library is safe to externalize
library RegistrationStorageLib {
    // sig: 0x92f03c86
    error RegistrationStorageInvalidError();

    function read(RegistrationStorage storage self) internal view returns (Registration memory) {
        StoredRegistration memory storedValue = self.value;
        return Registration(
            IMarket(storedValue.market),
            UFixed6.wrap(uint256(storedValue.weight)),
            UFixed6.wrap(uint256(storedValue.leverage))
        );
    }

    function store(RegistrationStorage storage self, Registration memory newValue) internal {
        if (newValue.weight.gt(UFixed6.wrap(type(uint32).max))) revert RegistrationStorageInvalidError();
        if (newValue.leverage.gt(UFixed6.wrap(type(uint32).max))) revert RegistrationStorageInvalidError();

        self.value = StoredRegistration(
            address(newValue.market),
            uint32(UFixed6.unwrap(newValue.weight)),
            uint32(UFixed6.unwrap(newValue.leverage)),
            bytes4(0)
        );
    }
}
