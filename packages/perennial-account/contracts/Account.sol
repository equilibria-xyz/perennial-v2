// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Instance } from "@equilibria/root/attribute/Instance.sol";
import { Token18 } from "@equilibria/root/token/types/Token18.sol";
import { UFixed6 } from "@equilibria/root/number/types/UFixed6.sol";

import { IAccount } from "./interfaces/IAccount.sol";

contract Account is Instance, IAccount{
    address private _owner;

    constructor(address owner) initializer(1) {
        __Instance__initialize();
        _owner = owner;
    }

    /// @inheritdoc IAccount
    function withdraw(Token18 token, UFixed6 amount) external {
        // TODO: implement
    }
}