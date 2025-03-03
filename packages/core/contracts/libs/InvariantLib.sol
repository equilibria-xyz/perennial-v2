// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { Fixed6Lib, UFixed6 } from "@equilibria/root/number/types/Fixed6.sol";
import { IMargin } from "../interfaces/IMargin.sol";
import { IMarket } from "../interfaces/IMarket.sol";
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
            !updateContext.signer &&   // sender is relaying the account's signed intention
            !updateContext.operator && // sender is operator approved for account
            !newOrder.isEmpty()        // sender is attempting to change position
        ) revert IMarket.MarketOperatorNotAllowedError();

        if (
            context.global.currentId > context.global.latestId + context.marketParameter.maxPendingGlobal ||
            context.local.currentId > context.local.latestId + context.marketParameter.maxPendingLocal
        ) revert IMarket.MarketExceedsPendingIdLimitError();

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
            validateSocialization(context, updateContext) &&
            newOrder.decreasesLiquidity(updateContext.currentPositionGlobal)
        ) revert IMarket.MarketInsufficientLiquidityError();
    }

    function validateProtection(IMarket.Context memory context, bool maintained, Order memory newOrder) external pure returns (bool) {
        if (context.pendingLocal.crossesZero()) {
            if (!newOrder.isEmpty()) return false; // pending zero-cross, liquidate (lock) with no-op order
        } else {
            if (!context.pendingLocal.neg().eq(context.latestPositionLocal.magnitude())) return false; // no pending zero-cross, liquidate with full close
        }

        if (maintained) return false; // latest position is properly maintained

        // TODO: can eliminate because close method doesn't allow increase in position and does not touch collateral
        if (!newOrder.collateral.eq(Fixed6Lib.ZERO) || // the order is modifying collateral
            !newOrder.pos().eq(UFixed6Lib.ZERO)        // the order is increasing position
        ) return false;

        return true;
    }

    function validateSocialization(IMarket.Context memory context, IMarket.UpdateContext memory updateContext) internal pure returns (bool) {
        UFixed6 maker = context.latestPositionGlobal.maker.sub(context.pendingGlobal.makerNeg);
        UFixed6 long = updateContext.currentPositionGlobal.long;
        UFixed6 short = updateContext.currentPositionGlobal.short;
        return maker.add(short).lt(long) || maker.add(long).lt(short);
    }
}
