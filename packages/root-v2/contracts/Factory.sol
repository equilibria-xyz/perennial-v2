// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
import "@openzeppelin/contracts/proxy/beacon/IBeacon.sol";
import "./IFactory.sol";
import "./UPausable.sol";

/**
 * @title Factory
 * @notice
 * @dev
 */
abstract contract Factory is IFactory, UOwnable, UPausable {
    address public immutable implementation;

    constructor(address implementation_) { implementation = implementation_; }

    function __Factory__initialize() internal onlyInitializer {
        __UOwnable__initialize();
    }

    function _create(bytes memory data) internal returns (address) {
        return address(new BeaconProxy(address(this), data));
    }
}
