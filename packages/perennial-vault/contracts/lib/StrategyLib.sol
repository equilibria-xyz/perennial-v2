// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "../types/Registration.sol";

library StrategyLib {
    struct MarketContext {
        MarketParameter marketParameter;
        RiskParameter riskParameter;
        Local local;
        Position position;
        Fixed6 price;
        UFixed6 maintenance;
    }

    struct MarketTarget {
        Fixed6 collateral;
        UFixed6 position;
    }

    function allocate(
        Registration memory registrations,
        UFixed6 collateral,
        UFixed6 assets
    ) internal pure returns (MarketTarget[] memory targets) {
        MarketContext[] memory contexts = new MarketContext[](registrations.length);
        for (uint256 marketId; marketId < registrations.length; marketId++)
            contexts[marketId] = _loadContext(registrations[marketId]);

        (uint256 totalWeight, UFixed6 totalMaintenance) = _aggregate(registrations, contexts);

        targets = new MarketTarget[](registrations.length);
        for (uint256 marketId; marketId < registrations.length; marketId++) {
            UFixed6 marketCollateral = contexts[marketId].maintenance
                .add(collateral.sub(totalMaintenance).muldiv(registrations[marketId].weight, totalWeight));

            UFixed6 marketAssets = assets
                .muldiv(registrations[marketId].weight, totalWeight)
                .min(targets[marketId].collateral);

            if (
                contexts[marketId].marketParameter.closed ||
                marketAssets.lt(contexts[marketId].riskParameter.minMaintenance)
            ) marketAssets = UFixed6Lib.ZERO;

            targets[marketId] = MarketTarget(
                Fixed6Lib.from(marketCollateral).sub(contexts[marketId].local.collateral),
                marketAssets.muldiv(registrations[marketId].leverage, contexts[marketId].price)
            );
        }
    }

    function _loadContext(Registration memory registration) private returns (MarketContext memory context) {
        context.marketParameter = registration.market.parameter();
        context.riskParameter = registration.market.riskParameter();
        context.local = registration.market.locals(address(this));
        context.position = registration.market.latestPositions(address(this));

        Global memory global = registration.market.at(context.position.timestamp);
        OracleVersion memory oracleVersion = registration.market.at(context.position.timestamp);
        context.price = oracleVersion.valid ? oracleVersion.price.abs() : global.latestPrice.abs();

        for (uint256 id = context.position.id; id < context.local.currentId; id++)
            context.maintenance = registration.market.pendingPositions(address(this), id)
                .maintenance(context.price, context.riskParameter)
                .max(context.maintenance);
    }

    function _aggregate(
        Registration[] memory registrations,
        MarketContext[] memory contexts
    ) private pure returns (uint256 totalWeight, UFixed6 totalMaintenance) {
        for (uint256 marketId; marketId < registrations.length; marketId++) {
            totalWeight += registrations[marketId].weight;
            totalMaintenance = totalMaintenance.add(contexts[marketId].maintenance);
        }
    }
}
