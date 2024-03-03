// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Fixed6, Fixed6Lib } from "@equilibria/root/number/types/Fixed6.sol";
import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import {
    MarketParameter,
    RiskParameter,
    Local,
    Global,
    Position,
    PositionLib,
    Order,
    OracleVersion
} from "@equilibria/perennial-v2/contracts/interfaces/IMarket.sol";
import { Registration } from "../types/Registration.sol";

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

    // @dev minimum position size before crossing the net position
    UFixed6 minPosition;

    // @dev maximum position size before crossing the maker limit
    UFixed6 maxPosition;
}

struct Strategy {
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
            strategy.totalMargin = strategy.totalMargin.add(strategy.marketContexts[marketId].margin);
            strategy.totalCollateral = strategy.totalCollateral.add(strategy.marketContexts[marketId].local.collateral);
            strategy.minAssets = strategy.minAssets.max(
                (registrations[marketId].leverage.isZero() || registrations[marketId].weight.isZero()) ?
                    UFixed6Lib.ZERO : // skip if no leverage or weight
                    strategy.marketContexts[marketId].minPosition
                        .muldiv(strategy.marketContexts[marketId].latestPrice.abs(), registrations[marketId].leverage)
                        .div(registrations[marketId].weight)
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
        UFixed6 collateral = UFixed6Lib.unsafeFrom(strategy.totalCollateral).add(deposit).unsafeSub(withdrawal);
        UFixed6 assets = collateral.unsafeSub(ineligable);

        if (collateral.lt(strategy.totalMargin)) revert StrategyLibInsufficientCollateralError();
        if (assets.lt(strategy.minAssets)) revert StrategyLibInsufficientAssetsError();

        targets = new MarketTarget[](strategy.marketContexts.length);
        UFixed6 totalMarketCollateral;
        for (uint256 marketId; marketId < strategy.marketContexts.length; marketId++) {
            UFixed6 marketCollateral;
            (targets[marketId], marketCollateral) = _allocateMarket(
                strategy.marketContexts[marketId],
                strategy.totalMargin,
                collateral,
                assets
            );
            totalMarketCollateral = totalMarketCollateral.add(marketCollateral);
        }

        if (strategy.marketContexts.length != 0)
            targets[0].collateral = targets[0].collateral.add(Fixed6Lib.from(collateral.sub(totalMarketCollateral)));
    }

    /// @notice Compute the target allocation for a market
    /// @param marketContext The context of the market
    /// @param totalMargin The total margin requirement of the vault
    /// @param collateral The total amount of collateral of the vault
    /// @param assets The total amount of collateral available for allocation
    function _allocateMarket(
        MarketStrategyContext memory marketContext,
        UFixed6 totalMargin,
        UFixed6 collateral,
        UFixed6 assets
    ) private pure returns (MarketTarget memory target, UFixed6 marketCollateral) {
        marketCollateral = marketContext.margin
            .add(collateral.sub(totalMargin).mul(marketContext.registration.weight));

        UFixed6 marketAssets = assets
            .mul(marketContext.registration.weight)
            .min(marketCollateral.mul(LEVERAGE_BUFFER));

        target.collateral = Fixed6Lib.from(marketCollateral).sub(marketContext.local.collateral);

        UFixed6 minAssets = marketContext.riskParameter.minMargin
            .unsafeDiv(marketContext.registration.leverage.mul(marketContext.riskParameter.maintenance));

        if (marketContext.marketParameter.closed || marketAssets.lt(minAssets)) marketAssets = UFixed6Lib.ZERO;

        target.position = marketAssets
            .muldiv(marketContext.registration.leverage, marketContext.latestPrice.abs())
            .max(marketContext.minPosition)
            .min(marketContext.maxPosition);
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
        OracleVersion memory latestVersion = registration.market.oracle().latest();

        marketContext.latestAccountPosition = registration.market.positions(address(this));
        marketContext.currentAccountPosition = marketContext.latestAccountPosition.clone();

        Order memory pendingLocal = registration.market.pendings(address(this));
        marketContext.currentAccountPosition.update(pendingLocal);

        marketContext.margin = PositionLib.margin(
            marketContext.latestAccountPosition.magnitude().add(pendingLocal.pos()),
            latestVersion,
            marketContext.riskParameter
        );
        marketContext.latestPrice = latestVersion.price;

        marketContext.closable = marketContext.latestAccountPosition.magnitude().sub(pendingLocal.neg());

        // current position
        Order memory pendingGlobal = registration.market.pendings(address(this));
        marketContext.currentPosition = registration.market.position();
        marketContext.currentPosition.update(pendingGlobal);
        marketContext.minPosition = marketContext.currentAccountPosition.maker
            .unsafeSub(marketContext.currentPosition.maker
                .unsafeSub(marketContext.currentPosition.skew().abs()).min(marketContext.closable));
        marketContext.maxPosition = marketContext.currentAccountPosition.maker
            .add(marketContext.riskParameter.makerLimit.unsafeSub(marketContext.currentPosition.maker));
    }
}
