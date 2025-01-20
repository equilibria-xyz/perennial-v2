//SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { Vault } from "./Vault.sol";
import { Target } from "./types/Target.sol";
import { MakerStrategyLib } from "./libs/MakerStrategyLib.sol";
import { IMakerVault } from "./interfaces/IMakerVault.sol";

/// @title MakerVault
/// @notice Deploys underlying capital by weight in maker positions across registered markets
/// @dev Vault deploys and rebalances collateral between the registered markets, while attempting to
///      maintain `targetLeverage` with its open maker positions at any given time. Deposits are only gated in so much
///      as to cap the maximum amount of assets in the vault.
contract MakerVault is IMakerVault, Vault {
    function _vaultName() internal pure override returns (string memory) {
        return "Perennial Maker Vault";
    }

    function _strategy(
        Context memory context,
        UFixed6 deposit,
        UFixed6 withdrawal,
        UFixed6 ineligible
    ) internal override view returns (Target[] memory targets) {
        return MakerStrategyLib.allocate(context.registrations, deposit, withdrawal, ineligible);
    }
}
