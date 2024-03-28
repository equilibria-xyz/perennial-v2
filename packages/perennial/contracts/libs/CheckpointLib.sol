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

struct CheckpointAccumulationResult {
    Fixed6 collateral;
    Fixed6 linearFee;
    Fixed6 proportionalFee;
    Fixed6 adiabaticFee;
    UFixed6 settlementFee;
    UFixed6 liquidationFee;
    UFixed6 subtractiveFee;
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
        Position memory fromPosition,
        Version memory fromVersion,
        Version memory toVersion
    ) external pure returns (Checkpoint memory next, CheckpointAccumulationResult memory result) {
        // accumulate
        result.collateral = _accumulateCollateral(fromPosition, fromVersion, toVersion);
        (result.linearFee, result.subtractiveFee) = _accumulateLinearFee(order, toVersion);
        result.proportionalFee = _accumulateProportionalFee(order, toVersion);
        result.adiabaticFee = _accumulateAdiabaticFee(order, toVersion);
        result.settlementFee = _accumulateSettlementFee(order, toVersion);
        result.liquidationFee = _accumulateLiquidationFee(order, toVersion);

        // update checkpoint
        next.collateral = self.collateral
            .sub(self.tradeFee)                       // trade fee processed post settlement
            .sub(Fixed6Lib.from(self.settlementFee))  // settlement / liquidation fee processed post settlement
            .add(self.transfer)                       // deposit / withdrawal processed post settlement
            .add(result.collateral);                  // incorporate collateral change at this settlement
        next.transfer = order.collateral;
        next.tradeFee = result.linearFee.add(result.proportionalFee).add(result.adiabaticFee);
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
    /// @param toVersion The next version
    function _accumulateLinearFee(
        Order memory order,
        Version memory toVersion
    ) private pure returns (Fixed6 linearFee, UFixed6 subtractiveFee) {
        Fixed6 makerLinearFee = Fixed6Lib.ZERO
            .sub(toVersion.makerLinearFee.accumulated(Accumulator6(Fixed6Lib.ZERO), order.makerTotal()));
        Fixed6 takerLinearFee = Fixed6Lib.ZERO
            .sub(toVersion.takerLinearFee.accumulated(Accumulator6(Fixed6Lib.ZERO), order.takerTotal()));

        UFixed6 makerSubtractiveFee = order.makerTotal().isZero() ?
            UFixed6Lib.ZERO :
            UFixed6Lib.from(makerLinearFee).muldiv(order.makerReferral, order.makerTotal());
        UFixed6 takerSubtractiveFee = order.takerTotal().isZero() ?
            UFixed6Lib.ZERO :
            UFixed6Lib.from(takerLinearFee).muldiv(order.takerReferral, order.takerTotal());

        linearFee = makerLinearFee.add(takerLinearFee);
        subtractiveFee = makerSubtractiveFee.add(takerSubtractiveFee);
    }

    /// @notice Accumulate trade fees for the next position
    /// @param order The next order
    /// @param toVersion The next version
    function _accumulateProportionalFee(
        Order memory order,
        Version memory toVersion
    ) private pure returns (Fixed6) {
        return Fixed6Lib.ZERO
            .sub(toVersion.makerProportionalFee.accumulated(Accumulator6(Fixed6Lib.ZERO), order.makerTotal()))
            .sub(toVersion.takerProportionalFee.accumulated(Accumulator6(Fixed6Lib.ZERO), order.takerTotal()));
    }

    /// @notice Accumulate adiabatic fees for the next position
    /// @param order The next order
    /// @param toVersion The next version
    function _accumulateAdiabaticFee(
        Order memory order,
        Version memory toVersion
    ) private pure returns (Fixed6) {
        return Fixed6Lib.ZERO
            .sub(toVersion.makerPosFee.accumulated(Accumulator6(Fixed6Lib.ZERO), order.makerPos))
            .sub(toVersion.makerNegFee.accumulated(Accumulator6(Fixed6Lib.ZERO), order.makerNeg))
            .sub(toVersion.takerPosFee.accumulated(Accumulator6(Fixed6Lib.ZERO), order.takerPos()))
            .sub(toVersion.takerNegFee.accumulated(Accumulator6(Fixed6Lib.ZERO), order.takerNeg()));
    }


    /// @notice Accumulate settlement fees for the next position
    /// @param order The next order
    /// @param toVersion The next version
    function _accumulateSettlementFee(
        Order memory order,
        Version memory toVersion
    ) private pure returns (UFixed6) {
        return toVersion.settlementFee.accumulated(Accumulator6(Fixed6Lib.ZERO), UFixed6Lib.from(order.orders)).abs();
    }

    /// @notice Accumulate liquidation fees for the next position
    /// @param order The next order
    /// @param toVersion The next version
    function _accumulateLiquidationFee(
        Order memory order,
        Version memory toVersion
    ) private pure returns (UFixed6 liquidationFee) {
        if (order.protected())
            return toVersion.liquidationFee.accumulated(Accumulator6(Fixed6Lib.ZERO), UFixed6Lib.ONE).abs();
    }
}
