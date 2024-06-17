// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Fixed6, Fixed6Lib } from "@equilibria/root/number/types/Fixed6.sol";
import { UFixed6 } from "@equilibria/root/number/types/UFixed6.sol";
import { IController } from "../interfaces/IController.sol";
import { RebalanceConfig } from "../types/RebalanceConfig.sol";
import "hardhat/console.sol";

/// @title RebalanceLib
/// @notice Facilities for rebalancing collateral accounts
library RebalanceLib {
    /// @dev Compares actual market collateral for owner with their account's target
    /// @param marketConfig Rebalance group configuration for this market
    /// @param totalGroupCollateral Owner's collateral across all markets in the group
    /// @param marketCollateral Owner's actual amount of collateral in this market
    /// @return canRebalance True if actual collateral outside of configured threshold
    /// @return imbalance Difference between actual collateral and target collateral
    function checkMarket(
        RebalanceConfig memory marketConfig,
        Fixed6 totalGroupCollateral,
        Fixed6 marketCollateral
    ) external returns (bool canRebalance, Fixed6 imbalance) {
        Fixed6 targetCollateral = totalGroupCollateral.mul(Fixed6Lib.from(marketConfig.target));
        Fixed6 pctFromTarget = Fixed6Lib.ONE.sub(targetCollateral.div(marketCollateral));
        canRebalance = pctFromTarget.abs().gt(marketConfig.threshold);
        imbalance = marketCollateral.sub(targetCollateral);
        console.log("target is %s, imbalance is", UFixed6.unwrap(targetCollateral.abs()));
        console.logInt(Fixed6.unwrap(imbalance));
    }
}