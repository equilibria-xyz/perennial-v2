// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/control/interfaces/IOwnable.sol";
import "@openzeppelin/contracts/proxy/beacon/IBeacon.sol";
import "./IVault.sol";

interface IVaultFactory is IBeacon, IOwnable {
    event VaultCreated(IVault indexed vault, Token18 indexed asset, IMarket initialMarket);

    function factory() external view returns (IFactory);
    function initialize() external;
    function create(Token18 asset, IMarket initialMarket) external returns (IVault);
}
