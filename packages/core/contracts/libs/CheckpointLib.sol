// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Accumulator6 } from "@equilibria/root/accumulator/types/Accumulator6.sol";
import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { Fixed6, Fixed6Lib } from "@equilibria/root/number/types/Fixed6.sol";
import { IMarket } from "../interfaces/IMarket.sol";
import { Position } from "../types/Position.sol";
import { Order } from "../types/Order.sol";
import { Version } from "../types/Version.sol";
import { Checkpoint } from "../types/Checkpoint.sol";
import { Guarantee } from "../types/Guarantee.sol";

struct CheckpointAccumulationResponse {
    /// @dev Total Collateral change due to collateral, price override, and trade fee and offset
    Fixed6 collateral;

    /// @dev Liquidation fee accumulated for this checkpoint (only if the order is protected)
    UFixed6 liquidationFee;

    /// @dev Subtractive fee accumulated from the previous position to the next position (this amount is included in the linear fee)
    UFixed6 subtractiveFee;

    /// @dev Solver fee accumulated the previous position to the next position (this amount is included in the linear fee)
    UFixed6 solverFee;
}

struct CheckpointAccumulationResult {
    /// @dev Total Collateral change due to pnl, funding, and interest from the previous position to the next position
    Fixed6 collateral;

    /// @dev Collateral change from the difference between the price override and underlying market price
    Fixed6 priceOverride;

    /// @dev Trade fee accumulated for this checkpoint
    UFixed6 tradeFee;

    /// @dev Spread accumulated for this checkpoint
    Fixed6 spread;

    /// @dev Settlement fee charged for this checkpoint
    UFixed6 settlementFee;

    /// @dev Liquidation fee accumulated for this checkpoint (only if the order is protected)
    UFixed6 liquidationFee;

    /// @dev Subtractive fee accumulated from the previous position to the next position (this amount is included in the linear fee)
    UFixed6 subtractiveFee;

    /// @dev Solver fee accumulated the previous position to the next position (this amount is included in the linear fee)
    UFixed6 solverFee;
}

/// @title CheckpointLib
/// @dev (external-safe): this library is safe to externalize
/// @notice Manages the logic for the local order accumulation
library CheckpointLib {
    /// @notice Accumulate pnl and fees from the latest position to next position
    /// @param order The next order
    /// @param fromVersion The previous latest version
    /// @param toVersion The next latest version
    /// @return next The next checkpoint
    /// @return response The accumulated pnl and fees
    function accumulate(
        IMarket.Context memory context,
        IMarket.SettlementContext memory settlementContext,
        uint256 orderId,
        Order memory order,
        Guarantee memory guarantee,
        Version memory fromVersion,
        Version memory toVersion
    ) external returns (Checkpoint memory next, CheckpointAccumulationResponse memory) {
        CheckpointAccumulationResult memory result;

        // accumulate
        result.collateral = _accumulateCollateral(context.latestPositionLocal, order, fromVersion, toVersion);
        result.priceOverride = _accumulatePriceOverride(guarantee, toVersion);
        (result.tradeFee, result.subtractiveFee, result.solverFee) = _accumulateFee(order, guarantee, toVersion);
        result.spread = _accumulateSpread(order, guarantee, toVersion);
        result.settlementFee = _accumulateSettlementFee(order, guarantee, toVersion);
        result.liquidationFee = _accumulateLiquidationFee(order, toVersion);

        // update checkpoint
        next.collateral = settlementContext.latestCheckpoint.collateral
            .sub(settlementContext.latestCheckpoint.tradeFee)                       // trade fee processed post settlement
            .sub(Fixed6Lib.from(settlementContext.latestCheckpoint.settlementFee)); // settlement / liquidation fee processed post settlement
        next.collateral = next.collateral
            .add(settlementContext.latestCheckpoint.transfer)                       // deposit / withdrawal processed post settlement
            .add(result.collateral)                                                 // incorporate collateral change at this settlement
            .add(result.priceOverride);                                             // incorporate price override pnl at this settlement
        next.transfer = order.collateral;
        next.tradeFee = Fixed6Lib.from(result.tradeFee).add(result.spread);
        next.settlementFee = result.settlementFee.add(result.liquidationFee);

        emit IMarket.AccountPositionProcessed(context.account, orderId, order, result);

        return (next, _response(result));
    }

    /// @notice Converts the accumulation result into a response
    /// @param result The accumulation result
    /// @return response The accumulation response
    function _response(
        CheckpointAccumulationResult memory result
    ) private pure returns (CheckpointAccumulationResponse memory response) {
        response.collateral = result.collateral
            .add(result.priceOverride)
            .sub(Fixed6Lib.from(result.tradeFee))
            .sub(result.spread)
            .sub(Fixed6Lib.from(result.settlementFee));
        response.liquidationFee = result.liquidationFee;
        response.subtractiveFee = result.subtractiveFee;
        response.solverFee = result.solverFee;
    }

    /// @notice Accumulate pnl, funding, and interest from the latest position to next position
    /// @param fromPosition The previous latest position
    /// @param fromVersion The previous latest version
    /// @param toVersion The next version
    function _accumulateCollateral(
        Position memory fromPosition,
        Order memory order,
        Version memory fromVersion,
        Version memory toVersion
    ) private pure returns (Fixed6 collateral) {
        // calculate position after closes
        Position memory closedPosition = fromPosition.clone();
        closedPosition.updateClose(order);

        // calculate position after order
        Position memory toPosition = fromPosition.clone();
        toPosition.update(order);

        // collateral change pre position change
        collateral = collateral
            .add(toVersion.makerPreValue.accumulated(fromVersion.makerPreValue, fromPosition.maker))
            .add(toVersion.longPreValue.accumulated(fromVersion.longPreValue, fromPosition.long))
            .add(toVersion.shortPreValue.accumulated(fromVersion.shortPreValue, fromPosition.short));

       // collateral change after applying closing portion of order
        collateral = collateral
            .add(toVersion.makerCloseValue.accumulated(fromVersion.makerCloseValue, closedPosition.maker))
            .add(toVersion.longCloseValue.accumulated(fromVersion.longCloseValue, closedPosition.long))
            .add(toVersion.shortCloseValue.accumulated(fromVersion.shortCloseValue, closedPosition.short));

        // collateral change after applying entire order
        collateral = collateral
            .add(toVersion.longPostValue.accumulated(fromVersion.longPostValue, toPosition.long))
            .add(toVersion.shortPostValue.accumulated(fromVersion.shortPostValue, toPosition.short));
    }

    /// @notice Accumulate trade fees for the next position
    /// @param order The next order
    /// @param guarantee The next guarantee
    /// @param toVersion The next version
    function _accumulateFee(
        Order memory order,
        Guarantee memory guarantee,
        Version memory toVersion
    ) private pure returns (UFixed6 tradeFee, UFixed6 subtractiveFee, UFixed6 solverFee) {
        UFixed6 takerTotal = order.takerTotal().sub(guarantee.takerFee);

        // accumulate total trade fees on maker and taker orders
        UFixed6 makerFee = Fixed6Lib.ZERO
            .sub(toVersion.makerFee.accumulated(Accumulator6(Fixed6Lib.ZERO), order.makerTotal()))
            .abs();
        UFixed6 takerFee = Fixed6Lib.ZERO
            .sub(toVersion.takerFee.accumulated(Accumulator6(Fixed6Lib.ZERO), takerTotal))
            .abs();

        // compute portion of trade fees that are subtractive
        UFixed6 makerSubtractiveFee = order.makerTotal().isZero() ?
            UFixed6Lib.ZERO :
            makerFee.muldiv(order.makerReferral, order.makerTotal());
        UFixed6 takerSubtractiveFee = takerTotal.isZero() ?
            UFixed6Lib.ZERO :
            takerFee.muldiv(order.takerReferral, takerTotal);

        // compute portion of subtractive fees that are solver fees
        solverFee = takerTotal.isZero() ?
            UFixed6Lib.ZERO :
            takerFee.muldiv(guarantee.referral, takerTotal); // guarantee.referral is instantiated as a subset of order.takerReferral

        tradeFee = makerFee.add(takerFee);
        subtractiveFee = makerSubtractiveFee.add(takerSubtractiveFee).sub(solverFee);
    }

    /// @notice Accumulate spread charged for the next position
    /// @param order The next order
    /// @param guarantee The next guarantee
    /// @param toVersion The next version
    function _accumulateSpread(
        Order memory order,
        Guarantee memory guarantee,
        Version memory toVersion
    ) private pure returns (Fixed6) {
        (UFixed6 exposurePos, UFixed6 exposureNeg) = order.exposure(guarantee, toVersion);

        // flip sign because we want the accumulator to round up correctly, but need charged spread to be positive
        return Fixed6Lib.ZERO
            .sub(toVersion.spreadPos.accumulated(Accumulator6(Fixed6Lib.ZERO), exposurePos))
            .sub(toVersion.spreadNeg.accumulated(Accumulator6(Fixed6Lib.ZERO), exposureNeg));
    }


    /// @notice Accumulate settlement fees for the next position
    /// @param order The next order
    /// @param guarantee The next guarantee
    /// @param toVersion The next version
    function _accumulateSettlementFee(
        Order memory order,
        Guarantee memory guarantee,
        Version memory toVersion
    ) private pure returns (UFixed6) {
        uint256 orders = order.orders - guarantee.orders;

        return toVersion.settlementFee.accumulated(Accumulator6(Fixed6Lib.ZERO), UFixed6Lib.from(orders)).abs();
    }

    /// @notice Accumulate liquidation fees for the next position
    /// @param order The next order
    /// @param toVersion The next version
    function _accumulateLiquidationFee(
        Order memory order,
        Version memory toVersion
    ) private pure returns (UFixed6) {
        if (!order.protected()) return UFixed6Lib.ZERO;
        return toVersion.liquidationFee.accumulated(Accumulator6(Fixed6Lib.ZERO), UFixed6Lib.ONE).abs();
    }

    /// @notice Accumulate price override pnl for the next position
    /// @param guarantee The next guarantee
    /// @param toVersion The next version
    function _accumulatePriceOverride(
        Guarantee memory guarantee,
        Version memory toVersion
    ) private pure returns (Fixed6) {
        if (!toVersion.valid) return Fixed6Lib.ZERO;
        return guarantee.priceAdjustment(toVersion.price);
    }
}
