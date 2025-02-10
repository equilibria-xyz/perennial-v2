// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { Fixed6, Fixed6Lib } from "@equilibria/root/number/types/Fixed6.sol";
import { IMarket } from "../interfaces/IMarket.sol";
import { PositionLib } from "../types/Position.sol";
import { Order } from "../types/Order.sol";
import { Guarantee } from "../types/Guarantee.sol";
import { Position } from "../types/Position.sol";

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

        if (
            context.pendingLocal.invalidation != 0 &&                              // pending orders are partially invalidatable
            context.pendingLocal.neg().gt(context.latestPositionLocal.magnitude()) // total pending close is greater than latest position
        ) revert IMarket.MarketOverCloseError();

        if (newOrder.protected() && !_validateProtection(context, updateContext, newOrder, newGuarantee))
            revert IMarket.MarketInvalidProtectionError();

        if (
            !(context.latestPositionLocal.magnitude().isZero() && context.pendingLocal.isEmpty()) &&    // sender has no position
            !(newOrder.isEmpty() && newOrder.collateral.gte(Fixed6Lib.ZERO)) &&                         // sender is depositing zero or more into account, without position change
            (
                !context.latestOracleVersion.valid ||
                context.currentTimestamp - context.latestOracleVersion.timestamp >= context.riskParameter.staleAfter
            )                                                                                           // price is not stale
        ) revert IMarket.MarketStalePriceError();

        if (context.marketParameter.closed && newOrder.increasesPosition())
            revert IMarket.MarketClosedError();

        if (
            updateContext.currentPositionGlobal.maker.gt(context.riskParameter.makerLimit) &&
            newOrder.increasesMaker()
        ) revert IMarket.MarketMakerOverLimitError();

        if (!updateContext.currentPositionLocal.singleSided()) revert IMarket.MarketNotSingleSidedError();

        if (
            (!context.latestPositionLocal.maker.isZero() && !updateContext.currentPositionLocal.skew().isZero()) ||
            (!context.latestPositionLocal.skew().isZero() && !updateContext.currentPositionLocal.maker.isZero())
        ) revert IMarket.MarketNotSingleSidedError();

        if (context.pendingLocal.invalidation != 0 && context.pendingLocal.crossesZero())
            revert IMarket.MarketNotSingleSidedError();

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
                _worstCasePendingLocal(context, updateContext),
                context.latestOracleVersion,
                context.riskParameter,
                updateContext.collateralization,
                _effectiveCollateral(context, updateContext, newGuarantee)
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

        if (_effectiveCollateral(context, updateContext, newGuarantee).lt(Fixed6Lib.ZERO))
            revert IMarket.MarketInsufficientCollateralError();
    }

    /// @notice Returns the worst case pending position magnitude
    /// @dev For AMM pending orders, this is calculated by assuming all closing orders will be invalidated
    ///      For intent pending orders, this is the maximum position magnitude at any pending version
    /// @param context The context to use
    /// @param updateContext The update context to use
    /// @return The worst case pending position magnitude
    function _worstCasePendingLocal(
        IMarket.Context memory context,
        IMarket.UpdateContext memory updateContext
    ) private pure returns (UFixed6) {
        return context.pendingLocal.invalidation != 0
            ? context.latestPositionLocal.magnitude().add(context.pendingLocal.pos())                   // contains an amm order, use worst case w/ invalidation
            : updateContext.currentPositionLocal.magnitude().max(updateContext.maxPendingMagnitude);    // does not contain an amm order, use max pending magnitude
    }

    /// @notice Returns the effective collateral for the account
    /// @dev Takes into account
    ///      - the price override adjustment from pending intents and the new intent
    ///      - the pending intent fees (upper bounded by measuring the pending order fees)
    /// @param context The context to use
    /// @param updateContext The update context to use
    /// @param newGuarantee The new guarantee to use
    /// @return The effective collateral for margin / maintenance checks
    function _effectiveCollateral(
        IMarket.Context memory context,
        IMarket.UpdateContext memory updateContext,
        Guarantee memory newGuarantee
    ) private pure returns (Fixed6) {
        Guarantee memory pendingGuaranteeLocal; // approximate pending intent fees by measuring worst case
        UFixed6 pendingIntentFees =
            context.pendingLocal.takerFee(pendingGuaranteeLocal, context.latestOracleVersion, context.marketParameter);

        return context.local.collateral
            .add(updateContext.priceAdjustment)                                     // apply price override adjustment from pending intents if present
            .add(newGuarantee.priceAdjustment(context.latestOracleVersion.price))   // apply price override adjustment from new intent if present
            .sub(Fixed6Lib.from(pendingIntentFees));                                // add pending intent fees (upper bounded by assuming no pending guarantee)
    }

    /// @notice Validates the protection of the market
    /// @param context The context to use
    /// @param updateContext The update context to use
    /// @param newOrder The new order to validate the protection for
    /// @param newGuarantee The new guarantee to validate the protection for
    /// @return True if the protection is valid, false otherwise
    function _validateProtection(
        IMarket.Context memory context,
        IMarket.UpdateContext memory updateContext,
        Order memory newOrder,
        Guarantee memory newGuarantee
    ) private pure returns (bool) {
        if (context.pendingLocal.crossesZero()) {
            if (!newOrder.isEmpty()) return false; // pending zero-cross, liquidate (lock) with no-op order
        } else {
            if (context.pendingLocal.neg().lt(context.latestPositionLocal.magnitude())) return false; // no pending zero-cross, liquidate with full close
        }

        if (context.latestPositionLocal.maintained(
            context.latestOracleVersion,
            context.riskParameter,
            _effectiveCollateral(context, updateContext, newGuarantee)
        )) return false; // latest position is properly maintained

        if (!newOrder.collateral.eq(Fixed6Lib.ZERO)) return false; // the order is modifying collateral

        if (!newOrder.pos().eq(UFixed6Lib.ZERO)) return false; // the order is increasing position

        return true;
    }
}
