// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/storage/UStorage.sol";
import "@equilibria/root/control/unstructured/UInitializable.sol";

/**
 * @title UInstance
 * @notice
 * @dev
 */
abstract contract UInstance is UInitializable {
    /// @dev The factory address
    AddressStorage private constant _factory = AddressStorage.wrap(keccak256("equilibria.root.UInstance.factory"));
    function factory() public view returns (address) { return _factory.read(); }

    /**
     * @notice Initializes the contract setting `msg.sender` as the initial owner
     */
    function __UInstance__initialize() internal onlyInitializer {
        _factory.store(msg.sender);
    }
}
