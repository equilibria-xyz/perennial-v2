// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Fixed6, Fixed6Lib } from "@equilibria/root/number/types/Fixed6.sol";
import { UFixed6 } from "@equilibria/root/number/types/UFixed6.sol";
import { IController } from "../interfaces/IController.sol";
import { RebalanceConfig } from "../types/RebalanceConfig.sol";

/// @title RebalanceLib
/// @notice Facilities for rebalancing collateral accounts
library RebalanceLib {
    /// @dev Compares actual market collateral for owner with their account's target
    /// @param marketConfig Rebalance group configuration for this market
    /// @param groupCollateral Owner's collateral across all markets in the group
    /// @param marketCollateral Owner's actual amount of collateral in this market
    /// @return canRebalance True if actual collateral in this market is outside of configured threshold
    /// @return imbalance Amount which needs to be transferred to balance the market
    function checkMarket(
        RebalanceConfig memory marketConfig,
        Fixed6 groupCollateral,
        Fixed6 marketCollateral
    ) internal pure returns (bool canRebalance, Fixed6 imbalance) {
        // determine how much collateral the market should have
        Fixed6 targetCollateral = groupCollateral.mul(Fixed6Lib.from(marketConfig.target));

        // if market is empty, prevent divide-by-zero condition
        if (marketCollateral.eq(Fixed6Lib.ZERO)) return (false, targetCollateral);
        // calculate percentage difference between target and actual collateral
        Fixed6 pctFromTarget = Fixed6Lib.ONE.sub(targetCollateral.div(marketCollateral));
        // if this percentage exceeds the configured threshold, the market may be rebelanced
        canRebalance = pctFromTarget.abs().gt(marketConfig.threshold);

        // return negative number for surplus, positive number for deficit
        imbalance = targetCollateral.sub(marketCollateral);
    }
}