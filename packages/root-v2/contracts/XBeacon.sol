// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@openzeppelin/contracts/proxy/beacon/IBeacon.sol";

/**
 * @title XBeacon
 * @notice
 * @dev
 */
abstract contract XBeacon is IBeacon {
    address public immutable implementation;
    constructor(address implementation_) { implementation = implementation_; }
}
