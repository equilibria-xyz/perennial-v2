// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { Fixed6Lib } from "@equilibria/root/number/types/Fixed6.sol";
import { IMarket } from "../interfaces/IMarket.sol";
import { PositionLib } from "../types/Position.sol";
import { Order } from "../types/Order.sol";
import { Guarantee } from "../types/Guarantee.sol";

/// @title InvariantLib
/// @dev (external-safe): this library is safe to externalize
/// @notice Manages the logic for the system invariant
library InvariantLib {
    /// @notice Verifies the invariant of the market
    /// @param context The context to use
    /// @param updateContext The update context to use
    /// @param newOrder The order to verify the invariant for
    /// @param newGuarantee The guarantee to verify the invariant for
    function validate(
        IMarket.Context memory context,
        IMarket.UpdateContext memory updateContext,
        Order memory newOrder,
        Guarantee memory newGuarantee
    ) external {
        // emit created event first due to early return
        emit IMarket.OrderCreated(
            context.account,
            newOrder,
            newGuarantee,
            updateContext.liquidator,
            updateContext.orderReferrer,
            updateContext.guaranteeReferrer
        );

        if (context.pendingLocal.neg().gt(context.latestPositionLocal.magnitude())) // total pending close is greater than latest position
            revert IMarket.MarketOverCloseError();

        if (newOrder.protected() && (
            !context.pendingLocal.neg().eq(context.latestPositionLocal.magnitude()) ||  // total pending close is not equal to latest position
            context.latestPositionLocal.maintained(                                     // latest position is properly maintained
                context.latestOracleVersion,
                context.riskParameter,
                context.local.collateral
            ) ||
            !newOrder.collateral.eq(Fixed6Lib.ZERO) ||                                  // the order is modifying collateral
            !newOrder.pos().eq(UFixed6Lib.ZERO)                                         // the order is increasing position
        )) revert IMarket.MarketInvalidProtectionError();

        if (
            !(updateContext.currentPositionLocal.magnitude().isZero() && context.latestPositionLocal.magnitude().isZero()) &&       // sender has no position
            !(newOrder.isEmpty() && newOrder.collateral.gte(Fixed6Lib.ZERO)) &&                                                     // sender is depositing zero or more into account, without position change
            (
                !context.latestOracleVersion.valid ||
                context.currentTimestamp - context.latestOracleVersion.timestamp >= context.riskParameter.staleAfter
            )                                                                                                                       // price is not stale
        ) revert IMarket.MarketStalePriceError();

        if (context.marketParameter.closed && newOrder.increasesPosition())
            revert IMarket.MarketClosedError();

        if (
            updateContext.currentPositionGlobal.maker.gt(context.riskParameter.makerLimit) &&
            newOrder.increasesMaker()
        ) revert IMarket.MarketMakerOverLimitError();

        if (
            !updateContext.currentPositionLocal.singleSided() || (                                              // current position is not single-sided with order applied
                context.latestPositionLocal.direction() != updateContext.currentPositionLocal.direction() &&    // latest and current positions are not in the same direction
                (!context.latestPositionLocal.empty() && !updateContext.currentPositionLocal.empty())           // both latest and current positions are non-empty
            )
        ) revert IMarket.MarketNotSingleSidedError();

        if (newGuarantee.priceDeviation(context.latestOracleVersion.price).gt(context.marketParameter.maxPriceDeviation))
            revert IMarket.MarketIntentPriceDeviationError();

        if (newOrder.protected()) return; // The following invariants do not apply to protected position updates (liquidations)

        if (
            !updateContext.signer &&                                            // sender is relaying the account's signed intention
            !updateContext.operator &&                                          // sender is operator approved for account
            !(newOrder.isEmpty() && newOrder.collateral.gte(Fixed6Lib.ZERO))    // sender is depositing zero or more into account, without position change
        ) revert IMarket.MarketOperatorNotAllowedError();

        if (
            context.global.currentId > context.global.latestId + context.marketParameter.maxPendingGlobal ||
            context.local.currentId > context.local.latestId + context.marketParameter.maxPendingLocal
        ) revert IMarket.MarketExceedsPendingIdLimitError();

        if (
            !PositionLib.margined(
                context.latestPositionLocal.magnitude().add(context.pendingLocal.pos()),
                context.latestOracleVersion,
                context.riskParameter,
                updateContext.collateralization,
                context.local.collateral
                    .add(updateContext.priceAdjustment)                                     // apply price override adjustment from pending intents if present
                    .add(newGuarantee.priceAdjustment(context.latestOracleVersion.price))   // apply price override adjustment from new intent if present
            )
        ) revert IMarket.MarketInsufficientMarginError();

        if (
            context.pendingLocal.protected() && // total pending position is protected
            !newOrder.protected()               // protection did not occur in this order (semphore already handles double-protection case)
        ) revert IMarket.MarketProtectedError();

        if (
            newOrder.liquidityCheckApplicable(context.marketParameter) &&
            newOrder.decreasesEfficiency(updateContext.currentPositionGlobal) &&
            updateContext.currentPositionGlobal.efficiency().lt(context.riskParameter.efficiencyLimit)
        ) revert IMarket.MarketEfficiencyUnderLimitError();

        if (
            newOrder.liquidityCheckApplicable(context.marketParameter) &&
            updateContext.currentPositionGlobal.socialized() &&
            newOrder.decreasesLiquidity(updateContext.currentPositionGlobal)
        ) revert IMarket.MarketInsufficientLiquidityError();

        if (context.local.collateral.lt(Fixed6Lib.ZERO))
            revert IMarket.MarketInsufficientCollateralError();
    }
}
