// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/attribute/interfaces/IFactory.sol";
import "@equilibria/perennial-v2/contracts/interfaces/IMarketFactory.sol";
import "./IVault.sol";


interface IVaultFactory is IFactory {
    event OperatorUpdated(address indexed account, address indexed operator, bool newEnabled);
    event VaultCreated(IVault indexed vault, Token18 indexed asset, IMarket initialMarket);

    function marketFactory() external view returns (IMarketFactory);
    function initialize() external;
    function operators(address account, address operator) external view returns (bool);
    function updateOperator(address operator, bool newEnabled) external;
    function create(Token18 asset, IMarket initialMarket, string calldata name) external returns (IVault);
}
