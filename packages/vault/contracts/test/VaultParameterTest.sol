// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { VaultParameter, VaultParameterStorage } from "../types/VaultParameter.sol";

contract VaultParameterTester {
    VaultParameterStorage public vaultParameter;

    function store(VaultParameter memory newVaultParameter) external {
        vaultParameter.store(newVaultParameter);
    }

    function read() external view returns (VaultParameter memory) {
        return vaultParameter.read();
    }
}
