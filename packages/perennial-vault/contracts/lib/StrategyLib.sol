// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "../types/Registration.sol";

/// @dev The context of an underlying market
struct MarketStrategyContext {
    /// @dev The market parameter set
    MarketParameter marketParameter;

    /// @dev The risk parameter set
    RiskParameter riskParameter;

    /// @dev The local state of the vault
    Local local;

    /// @dev The vault's current account position
    Position currentAccountPosition;

    /// @dev The vault's latest account position
    Position latestAccountPosition;

    /// @dev The current global position
    Position currentPosition;

    /// @dev The latest valid price
    Fixed6 latestPrice;

    /// @dev The margin requirement of the vault
    UFixed6 margin;

    /// @dev The current closable amount of the vault
    UFixed6 closable;

    // @dev The pending fees of the vault
    UFixed6 pendingFee;
}

struct Strategy {
    MarketStrategyContext[] marketContexts;
}
using StrategyLib for Strategy global;

/// @title Strategy
/// @notice Logic for vault capital allocation
/// @dev - Deploys collateral first to satisfy the margin of each market, then deploys the rest by weight.
///      - Positions are then targeted based on the amount of collateral that ends up deployed to each market.
library StrategyLib {
    error StrategyLibInsufficientMarginError();

    /// @dev The maximum multiplier that is allowed for leverage
    UFixed6 public constant LEVERAGE_BUFFER = UFixed6.wrap(1.2e6);

    /// @dev The target allocation for a market
    struct MarketTarget {
        /// @dev The amount of change in collateral
        Fixed6 collateral;

        /// @dev The new position
        UFixed6 position;
    }

    /// @dev Internal struct to avoid stack to deep error
    struct _AllocateLocals {
        UFixed6 marketCollateral;
        UFixed6 marketAssets;
        UFixed6 minPosition;
        UFixed6 maxPosition;
        UFixed6 minAssets;
        uint256 totalWeight;
        UFixed6 totalMargin;
    }

    function load(Registration[] memory registrations) internal view returns (Strategy memory strategy) {
        strategy.marketContexts = new MarketStrategyContext[](registrations.length);
        for (uint256 marketId; marketId < registrations.length; marketId++)
            strategy.marketContexts[marketId] = _loadContext(registrations[marketId]);
    }

    function maxRedeem(
        Strategy memory strategy,
        Registration[] memory registrations,
        uint256 totalWeight,
        UFixed6 collateral
    ) internal pure returns (UFixed6 redemptionAssets) {
        redemptionAssets = UFixed6Lib.MAX;
        MarketTarget[] memory targets = _allocate(strategy, registrations, collateral, collateral);

        for (uint256 marketId; marketId < strategy.marketContexts.length; marketId++) {
            MarketStrategyContext memory marketContext = strategy.marketContexts[marketId];
            Registration memory registration = registrations[marketId];

            // If market has 0 weight, leverage, or position, skip
            if (
                registration.weight == 0 ||
                registration.leverage.isZero() || (
                    marketContext.latestAccountPosition.maker.isZero() &&
                    marketContext.currentAccountPosition.maker.isZero()
                )
            ) continue;

            (UFixed6 minPosition, ) = _positionLimit(marketContext);
            UFixed6 availableClosable = targets[marketId].position.unsafeSub(minPosition);

            if (minPosition.isZero()) continue; // entire position can be closed, don't limit in cases of price deviation

            redemptionAssets = availableClosable
                .muldiv(marketContext.latestPrice.abs(), registration.leverage) // available collateral
                .muldiv(totalWeight, registration.weight)                       // collateral in market
                .min(redemptionAssets);
        }
    }

    /// @notice Compute the target allocation for each market
    /// @param strategy The strategy of the vault
    /// @param registrations The registrations of the markets
    /// @param collateral The amount of collateral to allocate
    /// @param assets The amount of collateral that is eligible for positions
    function allocate(
        Strategy memory strategy,
        Registration[] memory registrations,
        UFixed6 collateral,
        UFixed6 assets
    ) internal pure returns (MarketTarget[] memory targets) {
        targets = _allocate(strategy, registrations, collateral, assets);

        for (uint256 marketId; marketId < registrations.length; marketId++) {
            (UFixed6 minPosition, UFixed6 maxPosition) = _positionLimit(strategy.marketContexts[marketId]);
            targets[marketId].position = targets[marketId].position.max(minPosition).min(maxPosition);
        }
    }

    function _allocate(
        Strategy memory strategy,
        Registration[] memory registrations,
        UFixed6 collateral,
        UFixed6 assets
    ) internal pure returns (MarketTarget[] memory targets) {
        _AllocateLocals memory _locals;
        (_locals.totalWeight, _locals.totalMargin) = _aggregate(registrations, strategy.marketContexts);

        if (collateral.lt(_locals.totalMargin)) revert StrategyLibInsufficientMarginError();

        targets = new MarketTarget[](registrations.length);
        for (uint256 marketId; marketId < registrations.length; marketId++) {

            _locals.marketCollateral = strategy.marketContexts[marketId].margin
                .add(collateral.sub(_locals.totalMargin).muldiv(registrations[marketId].weight, _locals.totalWeight));

            _locals.marketAssets = assets
                .unsafeSub(strategy.marketContexts[marketId].pendingFee)
                .muldiv(registrations[marketId].weight, _locals.totalWeight)
                .min(_locals.marketCollateral.mul(LEVERAGE_BUFFER));

            _locals.minAssets = strategy.marketContexts[marketId].riskParameter.minMargin
                .unsafeDiv(registrations[marketId].leverage.mul(strategy.marketContexts[marketId].riskParameter.maintenance));
            if (strategy.marketContexts[marketId].marketParameter.closed || _locals.marketAssets.lt(_locals.minAssets))
                _locals.marketAssets = UFixed6Lib.ZERO;

            (targets[marketId].collateral, targets[marketId].position) = (
                Fixed6Lib.from(_locals.marketCollateral).sub(strategy.marketContexts[marketId].local.collateral),
                _locals.marketAssets
                    .muldiv(registrations[marketId].leverage, strategy.marketContexts[marketId].latestPrice.abs())
            );
        }
    }

    /// @notice Load the context of a market
    /// @param registration The registration of the market
    /// @return marketContext The context of the market
    function _loadContext(Registration memory registration) private view returns (MarketStrategyContext memory marketContext) {
        marketContext.marketParameter = registration.market.parameter();
        marketContext.riskParameter = registration.market.riskParameter();
        marketContext.local = registration.market.locals(address(this));
        Global memory global = registration.market.global();
        marketContext.latestPrice = global.latestPrice;

        // latest position
        UFixed6 previousClosable;
        previousClosable = _loadPosition(
            marketContext,
            marketContext.latestAccountPosition = registration.market.positions(address(this)),
            previousClosable
        );
        marketContext.closable = marketContext.latestAccountPosition.maker;

        // pending positions
        for (uint256 id = marketContext.local.latestId + 1; id <= marketContext.local.currentId; id++)
            previousClosable = _loadPosition(
                marketContext,
                marketContext.currentAccountPosition = registration.market.pendingPositions(address(this), id),
                previousClosable
            );

        // current position
        Position memory latestPosition = registration.market.position();
        marketContext.currentPosition = registration.market.pendingPosition(global.currentId);
        marketContext.currentPosition.adjust(latestPosition);
        marketContext.pendingFee = marketContext.pendingFee
            .add(marketContext.local.pendingLiquidationFee(marketContext.latestAccountPosition));
    }

    /// @notice Loads one position for the context calculation
    /// @param marketContext The context of the market
    /// @param position The position to load
    /// @param previousMaker The previous maker position
    /// @return nextMaker The next maker position
    function _loadPosition(
        MarketStrategyContext memory marketContext,
        Position memory position,
        UFixed6 previousMaker
    ) private pure returns (UFixed6 nextMaker) {
        position.adjust(marketContext.latestAccountPosition);

        marketContext.margin = position
            .margin(OracleVersion(0, marketContext.latestPrice, true), marketContext.riskParameter)
            .max(marketContext.margin);
        marketContext.closable = marketContext.closable.sub(previousMaker.unsafeSub(position.maker));
        marketContext.pendingFee = marketContext.pendingFee
            .add(UFixed6Lib.unsafeFrom(position.fee)) // don't allocate negative fees
            .add(position.keeper);
        nextMaker = position.maker;
    }

    /// @notice Aggregate the context of all markets
    /// @param registrations The registrations of the markets
    /// @param marketContexts The contexts of the markets
    /// @return totalWeight The total weight of all markets
    /// @return totalMargin The total margin of all markets
    function _aggregate(
        Registration[] memory registrations,
        MarketStrategyContext[] memory marketContexts
    ) private pure returns (uint256 totalWeight, UFixed6 totalMargin) {
        for (uint256 marketId; marketId < registrations.length; marketId++) {
            totalWeight += registrations[marketId].weight;
            totalMargin = totalMargin.add(marketContexts[marketId].margin);
        }
    }

    /// @notice Compute the position limit of a market
    /// @param marketContext The context of the market
    /// @return The minimum position size before crossing the net position
    /// @return The maximum position size before crossing the maker limit
    function _positionLimit(MarketStrategyContext memory marketContext) private pure returns (UFixed6, UFixed6) {
        return (
            // minimum position size before crossing the net position
            marketContext.currentAccountPosition.maker
                .unsafeSub(marketContext.currentPosition.maker
                    .unsafeSub(marketContext.currentPosition.net()).min(marketContext.closable)),
            // maximum position size before crossing the maker limit
            marketContext.currentAccountPosition.maker
                .add(marketContext.riskParameter.makerLimit.unsafeSub(marketContext.currentPosition.maker))
        );
    }
}
