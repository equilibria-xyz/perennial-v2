// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Instance } from "@equilibria/root/attribute/Instance.sol";

// TODO: create and document IAccount interface

contract Account is Instance {
    address private _owner;

    constructor(address owner) initializer(1) {
        __Instance__initialize();
        _owner = owner;
    }
}