// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "../types/Registration.sol";

contract RegistrationTester {
    RegistrationStorage public registration;

    function store(Registration memory newRegistration) external {
        registration.store(newRegistration);
    }

    function read() external view returns (Registration memory) {
        return registration.read();
    }
}
