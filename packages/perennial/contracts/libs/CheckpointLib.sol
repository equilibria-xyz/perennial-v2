// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/accumulator/types/Accumulator6.sol";
import "../types/OracleVersion.sol";
import "../types/RiskParameter.sol";
import "../types/Global.sol";
import "../types/Local.sol";
import "../types/Order.sol";
import "../types/Version.sol";
import "../types/Checkpoint.sol";
import "../types/Guarantee.sol";

struct CheckpointAccumulationResult {
    Fixed6 collateral;
    Fixed6 priceOverride;
    UFixed6 tradeFee;
    Fixed6 offset;
    UFixed6 settlementFee;
    UFixed6 liquidationFee;
    UFixed6 subtractiveFee;
    UFixed6 solverFee;
}

/// @title CheckpointLib
/// @notice Manages the logic for the global order accumualation
library CheckpointLib {
    /// @notice Accumulate pnl and fees from the latest position to next position
    /// @param self The Local object to update
    /// @param order The next order
    /// @param fromPosition The previous latest position
    /// @param fromVersion The previous latest version
    /// @param toVersion The next latest version
    /// @return next The next checkpoint
    /// @return result The accumulated pnl and fees
    function accumulate(
        Checkpoint memory self,
        Order memory order,
        Guarantee memory guarantee,
        Position memory fromPosition,
        Version memory fromVersion,
        Version memory toVersion
    ) external pure returns (Checkpoint memory next, CheckpointAccumulationResult memory result) {
        // accumulate
        result.collateral = _accumulateCollateral(fromPosition, fromVersion, toVersion);
        result.priceOverride = _accumulatePriceOverride(guarantee, toVersion);
        (result.tradeFee, result.subtractiveFee, result.solverFee) = _accumulateFee(order, guarantee, toVersion);
        result.offset = _accumulateOffset(order, guarantee, toVersion);
        result.settlementFee = _accumulateSettlementFee(order, guarantee, toVersion);
        result.liquidationFee = _accumulateLiquidationFee(order, toVersion);

        // update checkpoint
        next.collateral = self.collateral
            .sub(self.tradeFee)                       // trade fee processed post settlement
            .sub(Fixed6Lib.from(self.settlementFee)); // settlement / liquidation fee processed post settlement
        next.collateral = next.collateral
            .add(self.transfer)                       // deposit / withdrawal processed post settlement
            .add(result.collateral)                   // incorporate collateral change at this settlement
            .add(result.priceOverride);               // incorporate price override pnl at this settlement
        next.transfer = order.collateral;
        next.tradeFee = Fixed6Lib.from(result.tradeFee).add(result.offset);
        next.settlementFee = result.settlementFee.add(result.liquidationFee);
    }

    /// @notice Accumulate pnl, funding, and interest from the latest position to next position
    /// @param fromPosition The previous latest position
    /// @param fromVersion The previous latest version
    /// @param toVersion The next version
    function _accumulateCollateral(
        Position memory fromPosition,
        Version memory fromVersion,
        Version memory toVersion
    ) private pure returns (Fixed6) {
        return toVersion.makerValue.accumulated(fromVersion.makerValue, fromPosition.maker)
            .add(toVersion.longValue.accumulated(fromVersion.longValue, fromPosition.long))
            .add(toVersion.shortValue.accumulated(fromVersion.shortValue, fromPosition.short));
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
        UFixed6 makerFee = Fixed6Lib.ZERO
            .sub(toVersion.makerFee.accumulated(Accumulator6(Fixed6Lib.ZERO), order.makerTotal()))
            .abs();
        UFixed6 takerFee = Fixed6Lib.ZERO
            .sub(toVersion.takerFee.accumulated(Accumulator6(Fixed6Lib.ZERO), order.takerTotal()))
            .abs();

        UFixed6 makerSubtractiveFee = order.makerTotal().isZero() ?
            UFixed6Lib.ZERO :
            makerFee.muldiv(order.makerReferral, order.makerTotal());
        UFixed6 takerSubtractiveFee = order.takerTotal().isZero() ?
            UFixed6Lib.ZERO :
            takerFee.muldiv(order.takerReferral, order.takerTotal());

        solverFee = order.takerTotal().isZero() ?
            UFixed6Lib.ZERO :
            takerFee.muldiv(guarantee.referral, order.takerTotal());

        tradeFee = makerFee.add(takerFee);
        subtractiveFee = makerSubtractiveFee.add(takerSubtractiveFee).sub(solverFee);
    }

    /// @notice Accumulate price offset for the next position
    /// @dev This includes adjustment for linear, proportional, and adiabatic order fees
    /// @param order The next order
    /// @param guarantee The next guarantee
    /// @param toVersion The next version
    function _accumulateOffset(
        Order memory order,
        Guarantee memory guarantee,
        Version memory toVersion
    ) private pure returns (Fixed6) {
        (UFixed6 takerPos, UFixed6 takerNeg) =
            (order.takerPos().sub(guarantee.takerPos), order.takerNeg().sub(guarantee.takerNeg));

        return Fixed6Lib.ZERO
            .sub(toVersion.makerOffset.accumulated(Accumulator6(Fixed6Lib.ZERO), order.makerTotal()))
            .sub(toVersion.takerPosOffset.accumulated(Accumulator6(Fixed6Lib.ZERO), takerPos))
            .sub(toVersion.takerNegOffset.accumulated(Accumulator6(Fixed6Lib.ZERO), takerNeg));
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
        return guarantee.taker().mul(toVersion.price).sub(guarantee.notional);
    }
}
