// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "../types/Registration.sol";

/// @dev The context of an underlying market
struct MarketStrategyContext {
    /// @dev Registration of the market
    Registration registration;

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

    // @dev minimum position size before crossing the net position
    UFixed6 minPosition;

    // @dev maximum position size before crossing the maker limit
    UFixed6 maxPosition;
}

struct Strategy {
    uint256 totalWeight;

    UFixed6 totalMargin;

    Fixed6 totalCollateral;

    UFixed6 minAssets;

    MarketStrategyContext[] marketContexts;
}
using StrategyLib for Strategy global;

/// @title Strategy
/// @notice Logic for vault capital allocation
/// @dev - Deploys collateral first to satisfy the margin of each market, then deploys the rest by weight.
///      - Positions are then targeted based on the amount of collateral that ends up deployed to each market.
library StrategyLib {
    error StrategyLibInsufficientCollateralError();
    error StrategyLibInsufficientAssetsError();

    /// @dev The maximum multiplier that is allowed for leverage
    UFixed6 public constant LEVERAGE_BUFFER = UFixed6.wrap(1.2e6);

    /// @dev The target allocation for a market
    struct MarketTarget {
        /// @dev The amount of change in collateral
        Fixed6 collateral;

        /// @dev The new position
        UFixed6 position;
    }

    /// @notice Loads the strategy context of each of the underlying markets
    /// @param registrations The registrations of the underlying markets
    /// @return strategy The strategy contexts of the vault
    function load(Registration[] memory registrations) internal view returns (Strategy memory strategy) {
        strategy.marketContexts = new MarketStrategyContext[](registrations.length);
        for (uint256 marketId; marketId < registrations.length; marketId++) {
            strategy.marketContexts[marketId] = _loadContext(registrations[marketId]);
            strategy.totalWeight += registrations[marketId].weight;
            strategy.totalMargin = strategy.totalMargin.add(strategy.marketContexts[marketId].margin);
            strategy.totalCollateral = strategy.totalCollateral.add(strategy.marketContexts[marketId].local.collateral);
        }

        // second pass to compute minAssets (TODO remove w/ totalWeight to one change)
        for (uint256 marketId; marketId < registrations.length; marketId++) {
            strategy.minAssets = strategy.minAssets.max(
                (registrations[marketId].leverage.isZero() || registrations[marketId].weight == 0) ?
                    UFixed6Lib.ZERO : // skip if no leverage or weight
                    strategy.marketContexts[marketId].minPosition
                        .muldiv(strategy.marketContexts[marketId].latestPrice.abs(), registrations[marketId].leverage)
                        .muldiv(strategy.totalWeight, registrations[marketId].weight)
            );
        }

        // second pass to compute minAssets (TODO remove w/ totalWeight to one change)
        for (uint256 marketId; marketId < registrations.length; marketId++) {
            strategy.minAssets = strategy.minAssets.max(
                (registrations[marketId].leverage.isZero() || registrations[marketId].weight == 0) ?
                    UFixed6Lib.ZERO : // skip if no leverage or weight
                    strategy.marketContexts[marketId].minPosition
                        .muldiv(strategy.marketContexts[marketId].latestPrice.abs(), registrations[marketId].leverage)
                        .muldiv(strategy.totalWeight, registrations[marketId].weight)
            );
        }
    }

    /// @notice Compute the target allocation for each market
    /// @param strategy The strategy of the vault
    /// @param deposit The amount of assets that are being deposited into the vault
    /// @param withdrawal The amount of assets to make available for withdrawal
    /// @param ineligable The amount of assets that are inapplicable for allocation
    function allocate(
        Strategy memory strategy,
        UFixed6 deposit,
        UFixed6 withdrawal,
        UFixed6 ineligable
    ) internal pure returns (MarketTarget[] memory targets) {
        UFixed6 totalDeployed;

        UFixed6 collateral = UFixed6Lib.unsafeFrom(strategy.totalCollateral).add(deposit).unsafeSub(withdrawal);
        UFixed6 assets = collateral.unsafeSub(ineligable);

        if (collateral.lt(strategy.totalMargin)) revert StrategyLibInsufficientCollateralError();
        if (assets.lt(strategy.minAssets)) revert StrategyLibInsufficientAssetsError();

        targets = new MarketTarget[](strategy.marketContexts.length);
        for (uint256 marketId; marketId < strategy.marketContexts.length; marketId++)
            (targets[marketId], totalDeployed) = _allocateMarket(
                strategy.marketContexts[marketId],
                totalDeployed,
                strategy.totalWeight,
                strategy.totalMargin,
                collateral,
                assets
            );

        targets[0].collateral = targets[0].collateral.add(Fixed6Lib.from(collateral.sub(totalDeployed)));
    }

    /// @notice Compute the target allocation for a market
    /// @param marketContext The context of the market
    /// @param totalDeployed The total amount of deployed collateral accumulator
    /// @param totalWeight The total weight of the vault
    /// @param totalMargin The total margin requirement of the vault
    /// @param collateral The total amount of collateral of the vault
    /// @param assets The total amount of collateral available for allocation
    function _allocateMarket(
        MarketStrategyContext memory marketContext,
        UFixed6 totalDeployed,
        uint256 totalWeight,
        UFixed6 totalMargin,
        UFixed6 collateral,
        UFixed6 assets
    ) private pure returns (MarketTarget memory target, UFixed6 newTotalDeployed) {
        UFixed6 marketCollateral = marketContext.margin
            .add(collateral.sub(totalMargin).muldiv(marketContext.registration.weight, totalWeight));

        UFixed6 marketAssets = assets
            .unsafeSub(marketContext.pendingFee)
            .muldiv(marketContext.registration.weight, totalWeight)
            .min(marketCollateral.mul(LEVERAGE_BUFFER));

        UFixed6 minAssets = marketContext.riskParameter.minMargin
            .unsafeDiv(marketContext.registration.leverage.mul(marketContext.riskParameter.maintenance));

        if (marketContext.marketParameter.closed || marketAssets.lt(minAssets)) marketAssets = UFixed6Lib.ZERO;

        (target.collateral, target.position, newTotalDeployed) = (
            Fixed6Lib.from(marketCollateral).sub(marketContext.local.collateral),
            _limitPosition(
                marketAssets.muldiv(marketContext.registration.leverage, marketContext.latestPrice.abs()),
                marketContext
            ),
            totalDeployed.add(marketCollateral)
        );
    }

    // TODO: remove w/ totalWeight to one change
    /// @dev required for stack too deep
    function _limitPosition(
        UFixed6 position,
        MarketStrategyContext memory marketContext
    ) private pure returns (UFixed6) {
        return position.max(marketContext.minPosition).min(marketContext.maxPosition);
    }

    /// @notice Load the context of a market
    /// @param registration The registration of the market
    /// @return marketContext The context of the market
    function _loadContext(
        Registration memory registration
    ) private view returns (MarketStrategyContext memory marketContext) {
        marketContext.registration = registration;
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
        marketContext.minPosition = marketContext.currentAccountPosition.maker
            .unsafeSub(marketContext.currentPosition.maker
                .unsafeSub(marketContext.currentPosition.net()).min(marketContext.closable));
        marketContext.maxPosition = marketContext.currentAccountPosition.maker
            .add(marketContext.riskParameter.makerLimit.unsafeSub(marketContext.currentPosition.maker));
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
}
