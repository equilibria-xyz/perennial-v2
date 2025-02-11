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
struct SolverStrategyContext {
    UFixed6 totalCollateral;

    MarketSolverStrategyContext[] markets;
}

/// @dev The context of an underlying market
struct MarketSolverStrategyContext {
    /// @dev Registration of the market
    Registration registration;

    /// @dev The market parameter set
    MarketParameter marketParameter;

    /// @dev The risk parameter set
    RiskParameter riskParameter;

    /// @dev The collateral of the market
    UFixed6 collateral;

    /// @dev The vault's current account position
    Fixed6 currentTaker;

    /// @dev The latest valid price
    Fixed6 latestPrice;

    // @dev minimum position size before crossing the net position
    UFixed6 minMagnitude;
}

/// @title SolverStrategy
/// @notice Logic for vault capital allocation
/// @dev (external-safe): this library is safe to externalize
///      - Deploys collateral first to satisfy the margin of each market, then deploys the rest by weight.
///      - Positions are then targeted based on the amount of collateral that ends up deployed to each market.
library SolverStrategyLib {
    /// @dev Cannot reallocate position due to pending trade prevent reallocated position from being under leverage limit.
    /// sig: 0xfadba457
    error SolverStrategyPendingTradeError();

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
        SolverStrategyContext memory context = _load(registrations);

        UFixed6 newCollateral = context.totalCollateral.add(deposit).unsafeSub(withdrawal);
        UFixed6 newAssets = newCollateral.unsafeSub(ineligible);

        targets = new Target[](context.markets.length);
        UFixed6 allocatedCollateral;
        for (uint256 marketId; marketId < context.markets.length; marketId++) {
            UFixed6 newMarketCollateral;
            (targets[marketId], newMarketCollateral) = _allocateMarket(
                context.markets[marketId],
                context.markets.length,
                context.totalCollateral,
                newCollateral,
                newAssets
            );
            allocatedCollateral = allocatedCollateral.add(newMarketCollateral);
        }

        // allocate remaining collateral dust
        if (context.markets.length != 0)
            targets[0].collateral = targets[0].collateral.add(Fixed6Lib.from(newCollateral.sub(allocatedCollateral)));
    }

    /// @notice Compute the target allocation for a market
    /// @dev Collateral -> Allocate deposits and withdraws pro-rata to market based on current balances
    ///      Position   -> Deleverage position via AMM if exceeding max leverage, otherwise do not change
    /// @param marketContext The context of the market
    /// @param latestCollateral The latest total amount of collateral of the vault
    /// @param newCollateral The new total amount of collateral of the vault
    /// @param newAssets The new total amount of collateral available for allocation
    function _allocateMarket(
        MarketSolverStrategyContext memory marketContext,
        uint256 markets,
        UFixed6 latestCollateral,
        UFixed6 newCollateral,
        UFixed6 newAssets
    ) private pure returns (Target memory target, UFixed6 newMarketCollateral) {
        newMarketCollateral = _allocateValue(marketContext, markets, latestCollateral, newCollateral);
        UFixed6 newMarketAssets = _allocateValue(marketContext, markets, latestCollateral, newAssets);

        target.collateral = Fixed6Lib.from(newMarketCollateral).sub(Fixed6Lib.from(marketContext.collateral));

        if (marketContext.marketParameter.closed || newMarketAssets.lt(marketContext.riskParameter.minMargin))
            newMarketAssets = UFixed6Lib.ZERO;

        UFixed6 maxMagnitude = newMarketAssets
            .muldiv(marketContext.registration.leverage, marketContext.latestPrice.abs());

        if (marketContext.minMagnitude.gt(maxMagnitude)) revert SolverStrategyPendingTradeError();

        UFixed6 newMagnitude = marketContext.currentTaker.abs()
            .max(marketContext.minMagnitude) // can't go below closable
            .min(maxMagnitude);              // can't go above leverage cap
        Fixed6 newTaker = Fixed6Lib.from(marketContext.currentTaker.sign(), newMagnitude);

        target.taker = newTaker.sub(marketContext.currentTaker);
    }

    function _allocateValue(
        MarketSolverStrategyContext memory marketContext,
        uint256 markets,
        UFixed6 latestCollateral,
        UFixed6 amount
    ) private pure returns (UFixed6) {
        return latestCollateral.isZero()
            ? amount.div(UFixed6Lib.from(markets)) // first deposit, allocate evenly
            : amount.muldiv(marketContext.collateral, latestCollateral); // follow on, allocate by current collateral distribution
    }

    /// @notice Loads the strategy context of each of the underlying markets
    /// @param registrations The registrations of the underlying markets
    /// @return context The strategy context of the vault
    function _load(Registration[] memory registrations) internal view returns (SolverStrategyContext memory context) {
        context.markets = new MarketSolverStrategyContext[](registrations.length);
        for (uint256 marketId; marketId < registrations.length; marketId++) {
            context.markets[marketId] = _loadContext(registrations[marketId]);
            context.totalCollateral = context.totalCollateral.add(context.markets[marketId].collateral);
        }
    }

    /// @notice Load the context of a market
    /// @param registration The registration of the market
    /// @return marketContext The context of the market
    function _loadContext(
        Registration memory registration
    ) private view returns (MarketSolverStrategyContext memory marketContext) {
        // market
        marketContext.registration = registration;
        marketContext.marketParameter = registration.market.parameter();
        marketContext.riskParameter = registration.market.riskParameter();
        marketContext.latestPrice = registration.market.oracle().latest().price;

        // local
        marketContext.collateral = UFixed6Lib.unsafeFrom(registration.market.locals(address(this)).collateral);
        Position memory currentAccountPosition = registration.market.positions(address(this));
        Order memory pendingLocal = registration.market.pendings(address(this));
        currentAccountPosition.update(pendingLocal);
        marketContext.currentTaker = currentAccountPosition.skew();
        marketContext.minMagnitude = pendingLocal.pos();
    }
}
