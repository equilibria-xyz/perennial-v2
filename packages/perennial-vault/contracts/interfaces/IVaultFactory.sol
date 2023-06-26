// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root-v2/contracts/IPausable.sol";
import "@equilibria/root/control/interfaces/IOwnable.sol";
import "@equilibria/root-v2/contracts/IFactory.sol";
import "@equilibria/perennial-v2/contracts/interfaces/IMarketFactory.sol";
import "./IVault.sol";


interface IVaultFactory is IFactory, IOwnable, IPausable {
    event VaultCreated(IVault indexed vault, Token18 indexed asset, IMarket initialMarket);

    function marketFactory() external view returns (IMarketFactory);
    function initialize() external;
    function create(Token18 asset, IMarket initialMarket, string calldata name, string calldata symbol) external returns (IVault);
}
