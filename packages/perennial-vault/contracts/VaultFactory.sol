// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "@equilibria/root/control/unstructured/UOwnable.sol";
import "@equilibria/root-v2/contracts/XFactory.sol";
import "@equilibria/root-v2/contracts/UPausable.sol";
import "./interfaces/IVaultFactory.sol";

/**
 * @title VaultFactory
 * @notice Manages creating new vaults
 */
contract VaultFactory is IVaultFactory, XFactory, UOwnable, UPausable {
    IMarketFactory public immutable marketFactory;

    constructor(IMarketFactory marketFactory_, address implementation_) XFactory(implementation_) {
        marketFactory = marketFactory_;
    }

    function initialize() external initializer(1) {
        __UOwnable__initialize();
    }

    function create(
        Token18 asset,
        IMarket initialMarket,
        string calldata name,
        string calldata symbol
    ) external returns (IVault newVault) {
        newVault = IVault(_create(abi.encodeCall(IVault.initialize, (asset, initialMarket, name, symbol))));
        emit VaultCreated(newVault, asset, initialMarket);
    }
}
