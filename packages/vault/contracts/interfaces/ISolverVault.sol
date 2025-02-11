//SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { UFixed6 } from "@equilibria/root/number/types/UFixed6.sol";
import { IVault } from "./IVault.sol";
import { IMarket } from "@perennial/v2-core/contracts/interfaces/IMarket.sol";

interface ISolverVault is IVault {
    // sig: 0xfadba457
    error SolverStrategyPendingTradeError();
    // sig: 0xea51dc6e
    error SolverVaultNotRegisteredError();
    // sig: 0x96a28ccd
    error SolverVaultNotCoordinatorError();

    function rebalance(IMarket from, IMarket to, UFixed6 amount) external;
}
