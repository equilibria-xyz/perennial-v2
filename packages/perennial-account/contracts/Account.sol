// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/attribute/Instance.sol";
// TODO: Ownable forces you to initialize with msg.sender.
// import "@equilibria/root/attribute/Ownable.sol";

// TODO: create and document IAccount interface

contract Account is Instance {

    address private _owner;

    // TODO: Consider making ctor private.  But someone could always create one 
    // with same interface but different logic using the same salt.
    constructor(address owner) initializer(1) {
        __Instance__initialize();
        // __Ownable__initialize();
        _owner = owner;
    }
}