// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

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

        if (
            context.pendingLocal.invalidation != 0 &&                              // pending orders are partially invalidatable
            context.pendingLocal.neg().gt(context.latestPositionLocal.magnitude()) // total pending close is greater than latest position
        ) revert IMarket.MarketOverCloseError();

        if (newOrder.protected() && !_validateProtection(context, newOrder))
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
                updateContext.currentPositionLocal.magnitude(),
                context.latestOracleVersion,
                context.riskParameter,
                updateContext.collateralization,
                context.local.collateral.add(newGuarantee.priceAdjustment(context.latestOracleVersion.price)) // apply price override adjustment from intent if present
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

    function _validateProtection(IMarket.Context memory context, Order memory newOrder) private pure returns (bool) {
        if (context.pendingLocal.crossesZero()) {
            if (!newOrder.isEmpty()) return false; // pending zero-cross, liquidate (lock) with no-op order
        } else {
            if (!context.pendingLocal.neg().eq(context.latestPositionLocal.magnitude())) return false; // no pending zero-cross, liquidate with full close
        }

        if (context.latestPositionLocal.maintained(
            context.latestOracleVersion,
            context.riskParameter,
            context.local.collateral
        )) return false; // latest position is properly maintained

        if (!newOrder.collateral.eq(Fixed6Lib.ZERO)) return false; // the order is modifying collateral

        return true;
    }
}
