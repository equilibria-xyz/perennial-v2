// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { IFactory } from "@equilibria/root/attribute/interfaces/IFactory.sol";
import { IMarket } from "@perennial/v2-core/contracts/interfaces/IMarket.sol";
import { IMarketFactory } from "@perennial/v2-core/contracts/interfaces/IMarketFactory.sol";
import { UFixed6 } from "@equilibria/root/number/types/UFixed6.sol";
import { Token18 } from "@equilibria/root/token/types/Token18.sol";
import { IVault } from "./IVault.sol";

interface IVaultFactory is IFactory {
    event OperatorUpdated(address indexed account, address indexed operator, bool newEnabled);
    event VaultCreated(IVault indexed vault, Token18 indexed asset, IMarket initialMarket);

    function initialAmount() external view returns (UFixed6);
    function marketFactory() external view returns (IMarketFactory);
    function initialize() external;
    function operators(address account, address operator) external view returns (bool);
    function updateOperator(address operator, bool newEnabled) external;
    function create(Token18 asset, IMarket initialMarket, string calldata name) external returns (IVault);
}
