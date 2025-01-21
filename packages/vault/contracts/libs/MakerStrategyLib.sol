// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Fixed6, Fixed6Lib } from "@equilibria/root/number/types/Fixed6.sol";
import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { MarketParameter } from "@perennial/v2-core/contracts/types/MarketParameter.sol";
import { RiskParameter } from "@perennial/v2-core/contracts/types/RiskParameter.sol";
import { Local } from "@perennial/v2-core/contracts/types/Local.sol";
import { Global } from "@perennial/v2-core/contracts/types/Global.sol";
import { Position, PositionLib } from "@perennial/v2-core/contracts/types/Position.sol";
import { Order } from "@perennial/v2-core/contracts/types/Order.sol";
import { OracleVersion } from "@perennial/v2-core/contracts/types/OracleVersion.sol";
import { Registration } from "../types/Registration.sol";
import { Target } from "../types/Target.sol";

/// @dev The context of overall strategy
struct MakerStrategyContext {
    UFixed6 totalMargin;

    Fixed6 totalCollateral;

    UFixed6 minAssets;

    MarketMakerStrategyContext[] markets;
}

/// @dev The context of an underlying market
struct MarketMakerStrategyContext {
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

/// @title MakerStrategy
/// @notice Logic for vault capital allocation
/// @dev (external-safe): this library is safe to externalize
///      - Deploys collateral first to satisfy the margin of each market, then deploys the rest by weight.
///      - Positions are then targeted based on the amount of collateral that ends up deployed to each market.
library MakerStrategyLib {
    // sig: 0xf90641dc
    error MakerStrategyInsufficientCollateralError();
    // sig: 0xb86270e3
    error MakerStrategyInsufficientAssetsError();

    /// @dev The maximum multiplier that is allowed for leverage
    UFixed6 public constant LEVERAGE_BUFFER = UFixed6.wrap(1.2e6);

    /// @notice Compute the target allocation for each market
    /// @param registrations The registrations of the underlying markets
    /// @param deposit The amount of assets that are being deposited into the vault
    /// @param withdrawal The amount of assets to make available for withdrawal
    /// @param ineligible The amount of assets that are inapplicable for allocation
    function allocate(
        Registration[] memory registrations,
        UFixed6 deposit,
        UFixed6 withdrawal,
        UFixed6 ineligible
    ) internal view returns (Target[] memory targets) {
        MakerStrategyContext memory context = _load(registrations);

        UFixed6 collateral = UFixed6Lib.unsafeFrom(context.totalCollateral).add(deposit).unsafeSub(withdrawal);
        UFixed6 assets = collateral.unsafeSub(ineligible);

        if (collateral.lt(context.totalMargin)) revert MakerStrategyInsufficientCollateralError();
        if (assets.lt(context.minAssets)) revert MakerStrategyInsufficientAssetsError();

        targets = new Target[](context.markets.length);
        UFixed6 totalMarketCollateral;
        for (uint256 marketId; marketId < context.markets.length; marketId++) {
            UFixed6 marketCollateral;
            (targets[marketId], marketCollateral) = _allocateMarket(
                context.markets[marketId],
                context.totalMargin,
                collateral,
                assets
            );
            totalMarketCollateral = totalMarketCollateral.add(marketCollateral);
        }

        if (context.markets.length != 0)
            targets[0].collateral = targets[0].collateral.add(Fixed6Lib.from(collateral.sub(totalMarketCollateral)));
    }

    /// @notice Compute the target allocation for a market
    /// @param marketContext The context of the market
    /// @param totalMargin The total margin requirement of the vault
    /// @param collateral The total amount of collateral of the vault
    /// @param assets The total amount of collateral available for allocation
    function _allocateMarket(
        MarketMakerStrategyContext memory marketContext,
        UFixed6 totalMargin,
        UFixed6 collateral,
        UFixed6 assets
    ) private pure returns (Target memory target, UFixed6 marketCollateral) {
        marketCollateral = marketContext.margin
            .add(collateral.sub(totalMargin).mul(marketContext.registration.weight));

        UFixed6 marketAssets = assets
            .mul(marketContext.registration.weight)
            .min(marketCollateral.mul(LEVERAGE_BUFFER));

        target.collateral = Fixed6Lib.from(marketCollateral).sub(marketContext.local.collateral);

        UFixed6 minAssets = marketContext.riskParameter.minMargin
            .unsafeDiv(marketContext.registration.leverage.mul(marketContext.riskParameter.maintenance));

        if (marketContext.marketParameter.closed || marketAssets.lt(minAssets)) marketAssets = UFixed6Lib.ZERO;

        UFixed6 newMaker = marketAssets
            .muldiv(marketContext.registration.leverage, marketContext.latestPrice.abs())
            .max(marketContext.minPosition)
            .min(marketContext.maxPosition);

        target.maker = Fixed6Lib.from(newMaker).sub(Fixed6Lib.from(marketContext.currentAccountPosition.maker));
    }

    /// @notice Loads the strategy context of each of the underlying markets
    /// @param registrations The registrations of the underlying markets
    /// @return context The strategy context of the vault
    function _load(Registration[] memory registrations) internal view returns (MakerStrategyContext memory context) {
        context.markets = new MarketMakerStrategyContext[](registrations.length);
        for (uint256 marketId; marketId < registrations.length; marketId++) {
            context.markets[marketId] = _loadContext(registrations[marketId]);
            context.totalMargin = context.totalMargin.add(context.markets[marketId].margin);
            context.totalCollateral = context.totalCollateral.add(context.markets[marketId].local.collateral);
            context.minAssets = context.minAssets.max(
                (registrations[marketId].leverage.isZero() || registrations[marketId].weight.isZero()) ?
                    UFixed6Lib.ZERO : // skip if no leverage or weight
                    context.markets[marketId].minPosition
                        .muldiv(context.markets[marketId].latestPrice.abs(), registrations[marketId].leverage)
                        .div(registrations[marketId].weight)
            );
        }
    }

    /// @notice Load the context of a market
    /// @param registration The registration of the market
    /// @return marketContext The context of the market
    function _loadContext(
        Registration memory registration
    ) private view returns (MarketMakerStrategyContext memory marketContext) {
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
            marketContext.riskParameter,
            UFixed6Lib.ZERO
        );
        marketContext.latestPrice = latestVersion.price;

        marketContext.closable = marketContext.latestAccountPosition.magnitude().sub(pendingLocal.neg());

        // current position
        Order memory pendingGlobal = registration.market.pending();
        marketContext.currentPosition = registration.market.position();
        marketContext.currentPosition.update(pendingGlobal);
        marketContext.minPosition = marketContext.currentAccountPosition.maker
            .unsafeSub(marketContext.currentPosition.maker
                .unsafeSub(marketContext.currentPosition.skew().abs()).min(marketContext.closable));
        marketContext.maxPosition = marketContext.currentAccountPosition.maker
            .add(marketContext.riskParameter.makerLimit.unsafeSub(marketContext.currentPosition.maker));
    }
}
