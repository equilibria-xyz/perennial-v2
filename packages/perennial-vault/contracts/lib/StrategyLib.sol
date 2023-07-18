// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "../types/Registration.sol";

library StrategyLib {
    UFixed6 private constant LEVERAGE_BUFFER = UFixed6.wrap(1.2e6); // TODO: param?

    struct MarketContext {
        MarketParameter marketParameter;
        RiskParameter riskParameter;
        Local local;
        Position currentAccountPosition;
        Position currentPosition;
        OracleVersion oracleVersion;
        UFixed6 maintenance;
    }

    struct MarketTarget {
        Fixed6 collateral;
        UFixed6 position;
    }

    /// @dev Internal struct to avoid stack to deep error
    struct _AllocateLocals {
        UFixed6 marketCollateral;
        UFixed6 marketAssets;
        UFixed6 minPosition;
        UFixed6 maxPosition;
    }

    function allocate(
        Registration[] memory registrations,
        UFixed6 collateral,
        UFixed6 assets
    ) internal view returns (MarketTarget[] memory targets) {
        MarketContext[] memory contexts = new MarketContext[](registrations.length);
        for (uint256 marketId; marketId < registrations.length; marketId++)
            contexts[marketId] = _loadContext(registrations[marketId]);

        (uint256 totalWeight, UFixed6 totalMaintenance) = _aggregate(registrations, contexts);

        targets = new MarketTarget[](registrations.length);
        for (uint256 marketId; marketId < registrations.length; marketId++) {
            _AllocateLocals memory _locals;
            _locals.marketCollateral = contexts[marketId].maintenance
                .add(collateral.sub(totalMaintenance).muldiv(registrations[marketId].weight, totalWeight));

            _locals.marketAssets = assets
                .muldiv(registrations[marketId].weight, totalWeight)
                .min(_locals.marketCollateral.mul(LEVERAGE_BUFFER));

            if (
                contexts[marketId].marketParameter.closed ||
                _locals.marketAssets.lt(contexts[marketId].riskParameter.minMaintenance)
            ) _locals.marketAssets = UFixed6Lib.ZERO;

            (_locals.minPosition, _locals.maxPosition) = _positionLimit(contexts[marketId]);

            (targets[marketId].collateral, targets[marketId].position) = (
                Fixed6Lib.from(_locals.marketCollateral).sub(contexts[marketId].local.collateral),
                _locals.marketAssets
                    .muldiv(registrations[marketId].leverage, contexts[marketId].oracleVersion.price.abs())
                    .min(_locals.maxPosition)
                    .max(_locals.minPosition)
            );
        }
    }

    function _loadContext(Registration memory registration) private view returns (MarketContext memory context) {
        context.marketParameter = registration.market.parameter();
        context.riskParameter = registration.market.riskParameter();
        context.local = registration.market.locals(address(this));
        context.currentAccountPosition = registration.market.pendingPositions(address(this), context.local.currentId);

        Position memory latestAccountPosition = registration.market.positions(address(this));
        Global memory global = registration.market.global();
        context.oracleVersion = registration.market.at(latestAccountPosition.timestamp);
        context.currentPosition = registration.market.pendingPosition(global.currentId);
        if (!context.oracleVersion.valid) context.oracleVersion.price = global.latestPrice;

        for (uint256 id = latestAccountPosition.id; id < context.local.currentId; id++)
            context.maintenance = registration.market.pendingPositions(address(this), id)
                .maintenance(context.oracleVersion, context.riskParameter)
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

    function _positionLimit(MarketContext memory context) private pure returns (UFixed6, UFixed6) {
        return (
            // minimum position size before crossing the net position
            context.currentAccountPosition.maker.sub(
                context.currentPosition.maker
                    .sub(context.currentPosition.net().min(context.currentPosition.maker))
                    .min(context.currentAccountPosition.maker)
            ),
            // maximum position size before crossing the maker limit
            context.currentAccountPosition.maker.add(
                context.riskParameter.makerLimit
                    .sub(context.currentPosition.maker.min(context.riskParameter.makerLimit))
            )
        );
    }
}
