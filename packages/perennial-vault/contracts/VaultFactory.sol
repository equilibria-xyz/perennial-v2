// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "@equilibria/root/control/unstructured/UOwnable.sol";
import "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
import "./interfaces/IVaultFactory.sol";
import "@equilibria/root-v2/contracts/XBeacon.sol";

/**
 * @title VaultFactory
 * @notice Manages creating new vaults
 */
contract VaultFactory is IVaultFactory, XBeacon, UOwnable {
    IFactory public immutable factory;

    constructor(IFactory factory_, address implementation_) XBeacon(implementation_) {
        factory = factory_;
    }

    function initialize() external initializer(1) {
        __UOwnable__initialize();
    }

    function create(Token18 asset, IMarket initialMarket, string calldata name) external returns (IVault newVault) {
        newVault = IVault(address(new BeaconProxy(
            address(this),
            abi.encodeCall(IVault.initialize, (asset, initialMarket, name))
        )));
        emit VaultCreated(newVault, asset, initialMarket);
    }
}
