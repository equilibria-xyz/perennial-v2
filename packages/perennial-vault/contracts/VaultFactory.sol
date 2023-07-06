// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "@equilibria/root/control/unstructured/UOwnable.sol";
import "@equilibria/root-v2/contracts/Factory.sol";
import "@equilibria/root-v2/contracts/UPausable.sol";
import "./interfaces/IVaultFactory.sol";

/**
 * @title VaultFactory
 * @notice Manages creating new vaults
 */
contract VaultFactory is IVaultFactory, Factory {
    IMarketFactory public immutable marketFactory;

    mapping(address => mapping(address => bool)) public operators;

    constructor(IMarketFactory marketFactory_, address implementation_) Factory(implementation_) {
        marketFactory = marketFactory_;
    }

    function initialize() external initializer(1) {
        __Factory__initialize();
    }

    function create(
        Token18 asset,
        IMarket initialMarket,
        string calldata name,
        string calldata symbol
    ) external onlyOwner returns (IVault newVault) {
        // TODO: validation?

        newVault = IVault(address(_create(abi.encodeCall(IVault.initialize, (asset, initialMarket, name, symbol)))));

        emit VaultCreated(newVault, asset, initialMarket);
    }

    function updateOperator(address operator, bool newEnabled) external {
        operators[msg.sender][operator] = newEnabled;
        emit OperatorUpdated(msg.sender, operator, newEnabled);
    }
}
