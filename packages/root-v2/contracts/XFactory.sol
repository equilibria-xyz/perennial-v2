// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
import "@openzeppelin/contracts/proxy/beacon/IBeacon.sol";
import "./IFactory.sol";

/**
 * @title XFactory
 * @notice
 * @dev
 */
abstract contract XFactory is IFactory {
    address public immutable implementation;

    constructor(address implementation_) { implementation = implementation_; }

    function _create(bytes memory data) internal returns (address) {
        return address(new BeaconProxy(address(this), data));
    }
}
