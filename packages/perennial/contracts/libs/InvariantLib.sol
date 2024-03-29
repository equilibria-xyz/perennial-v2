// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/accumulator/types/Accumulator6.sol";
import "../interfaces/IMarket.sol";
import "../types/OracleVersion.sol";
import "../types/RiskParameter.sol";
import "../types/Global.sol";
import "../types/Local.sol";
import "../types/Order.sol";
import "../types/Version.sol";
import "../types/Checkpoint.sol";

/// @title InvariantLib
/// @notice Manages the logic for the system invariant
library InvariantLib {
    /// @notice Verifies the invariant of the market
    /// @param context The context to use
    /// @param account The account to verify the invariant for
    /// @param newOrder The order to verify the invariant for
    /// @param collateral The collateral change to verify the invariant for
    function validate(
        IMarket.Context memory context,
        IMarket.UpdateContext memory updateContext,
        address sender,
        address account,
        Order memory newOrder,
        Fixed6 collateral
    ) external pure {
        if (context.pendingLocalOrder.neg().gt(context.latestLocalPosition.magnitude())) revert IMarket.MarketOverCloseError();

        if (newOrder.protected() && (
            !context.pendingLocalOrder.neg().eq(context.latestLocalPosition.magnitude()) ||
            context.latestLocalPosition.maintained(
                context.latestOracleVersion,
                context.riskParameter,
                context.local.collateral.sub(collateral)
            ) ||
            collateral.lt(Fixed6Lib.ZERO) ||
            newOrder.magnitude().gte(Fixed6Lib.ZERO)
        )) revert IMarket.MarketInvalidProtectionError();

        if (
            !(updateContext.currentLocalPosition.magnitude().isZero() && context.latestLocalPosition.magnitude().isZero()) &&     // sender has no position
            !(newOrder.isEmpty() && collateral.gte(Fixed6Lib.ZERO)) &&                                                              // sender is depositing zero or more into account, without position change
            (context.currentTimestamp - context.latestOracleVersion.timestamp >= context.riskParameter.staleAfter)                  // price is not stale
        ) revert IMarket.MarketStalePriceError();

        if (context.marketParameter.closed && newOrder.increasesPosition())
            revert IMarket.MarketClosedError();

        if (
            updateContext.currentGlobalPosition.maker.gt(context.riskParameter.makerLimit) &&
            newOrder.increasesMaker()
        ) revert IMarket.MarketMakerOverLimitError();

        if (
            !updateContext.currentLocalPosition.singleSided() || (
                context.latestLocalPosition.direction() != updateContext.currentLocalPosition.direction() &&
                    !context.latestLocalPosition.empty() &&
                    !updateContext.currentLocalPosition.empty()
            )
        ) revert IMarket.MarketNotSingleSidedError();

        if (newOrder.protected()) return; // The following invariants do not apply to protected position updates (liquidations)

        if (
            sender != account &&                                    // sender is operating on own account
            !updateContext.operator &&                                  // sender is operator approved for account
            !(newOrder.isEmpty() && collateral.gte(Fixed6Lib.ZERO))     // sender is depositing zero or more into account, without position change
        ) revert IMarket.MarketOperatorNotAllowedError();

        if (
            context.global.currentId > context.global.latestId + context.marketParameter.maxPendingGlobal ||
            context.local.currentId > context.local.latestId + context.marketParameter.maxPendingLocal
        ) revert IMarket.MarketExceedsPendingIdLimitError();

        if (
            !PositionLib.margined(
                context.latestLocalPosition.magnitude().add(context.pendingLocalOrder.pos()),
                context.latestOracleVersion,
                context.riskParameter,
                context.local.collateral
            )
        ) revert IMarket.MarketInsufficientMarginError();

        if (context.pendingLocalOrder.protected() && !newOrder.protected() && !newOrder.isEmpty())
            revert IMarket.MarketProtectedError();

        if (
            newOrder.liquidityCheckApplicable(context.marketParameter) &&
            newOrder.decreasesEfficiency(updateContext.currentGlobalPosition) &&
            updateContext.currentGlobalPosition.efficiency().lt(context.riskParameter.efficiencyLimit)
        ) revert IMarket.MarketEfficiencyUnderLimitError();

        if (
            newOrder.liquidityCheckApplicable(context.marketParameter) &&
            updateContext.currentGlobalPosition.socialized() &&
            newOrder.decreasesLiquidity(updateContext.currentGlobalPosition)
        ) revert IMarket.MarketInsufficientLiquidityError();

        if (collateral.lt(Fixed6Lib.ZERO) && context.local.collateral.lt(Fixed6Lib.ZERO))
            revert IMarket.MarketInsufficientCollateralError();
    }
}
