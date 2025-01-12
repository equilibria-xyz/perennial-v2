//SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { Vault } from "./Vault.sol";
import { Target } from "./types/Target.sol";
import { SolverStrategyLib } from "./libs/SolverStrategyLib.sol";
import { IVaultFactory } from "./interfaces/IVaultFactory.sol";

/// @title SolverVault
/// @notice Allows the coordinator trade on behalf of the vault via signature.
/// @dev Vault deploys collateral pro-rata with current collateral distribution on deposit / withdraw.
///      Coordinator is able to trade on behalf of the vault via signature, as well as rebalance collateral between markets.
///      Coordinator can set the maximum leverage per market, with which the Vault will autoleverage on withdraw if necessary.
contract SolverVault is Vault {
    function _vaultName() internal pure override returns (string memory) {
        return "Perennial Solver Vault";
    }

    function _strategy(
        Context memory context,
        UFixed6 deposit,
        UFixed6 withdrawal,
        UFixed6 ineligible
    ) internal override view returns (Target[] memory targets) {
        return SolverStrategyLib.allocate(context.registrations, deposit, withdrawal, ineligible);
    }

    function updateCoordinator(address newCoordinator) public override onlyOwner {
        IVaultFactory(address(factory())).marketFactory().updateSigner(coordinator, false);
        IVaultFactory(address(factory())).marketFactory().updateSigner(newCoordinator, true);

        super.updateCoordinator(newCoordinator);
    }
}
