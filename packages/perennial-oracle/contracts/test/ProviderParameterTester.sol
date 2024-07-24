// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "../keeper/types/ProviderParameter.sol";

contract ProviderParameterTester {
    ProviderParameterStorage public providerParameter;

    function read() public view returns (ProviderParameter memory) {
        return providerParameter.read();
    }

    function store(ProviderParameter memory newProviderParameter) public {
        return providerParameter.store(newProviderParameter);
    }
}