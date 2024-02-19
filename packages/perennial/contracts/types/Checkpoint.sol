// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "./OracleVersion.sol";
import "./RiskParameter.sol";
import "./Global.sol";
import "./Local.sol";
import "./Order.sol";

/// @dev Checkpoint type
struct Checkpoint {
    /// @dev The trade fee that the order incurred at the checkpoint settlement
    Fixed6 tradeFee;

    // @dev The settlement and liquidation fee that the order incurred at the checkpoint settlement
    UFixed6 settlementFee;

    /// @dev The amount deposited or withdrawn at the checkpoint settlement
    Fixed6 transfer;

    /// @dev The collateral at the time of the checkpoint settlement
    Fixed6 collateral;
}
using CheckpointLib for Checkpoint global;
struct CheckpointStorage { uint256 slot0; }
using CheckpointStorageLib for CheckpointStorage global;


struct CheckpointAccumulationResult {
    Fixed6 collateral;
    Fixed6 linearFee;
    Fixed6 proportionalFee;
    Fixed6 adiabaticFee;
    UFixed6 settlementFee;
    UFixed6 liquidationFee;
    UFixed6 subtractiveFee;
}

/// @title Checkpoint
/// @notice Holds the state for a checkpoint
library CheckpointLib {
    /// @notice Accumulate pnl and fees from the latest position to next position
    /// @param self The Local object to update
    /// @param order The next order
    /// @param fromPosition The previous latest position
    /// @param fromVersion The previous latest version
    /// @param toVersion The next latest version
    /// @return result The accumulated pnl and fees
    function accumulate(
        Checkpoint memory self,
        Order memory order,
        Position memory fromPosition,
        Version memory fromVersion,
        Version memory toVersion
    ) internal pure returns (CheckpointAccumulationResult memory result) {
        // accumulate
        result.collateral = _accumulateCollateral(fromPosition, fromVersion, toVersion);
        (result.linearFee, result.subtractiveFee) = _accumulateLinearFee(order, toVersion);
        result.proportionalFee = _accumulateProportionalFee(order, toVersion);
        result.adiabaticFee = _accumulateAdiabaticFee(order, toVersion);
        result.settlementFee = _accumulateSettlementFee(order, toVersion);
        result.liquidationFee = _accumulateLiquidationFee(order, toVersion);

        // update checkpoint
        self.collateral = self.collateral
            .sub(self.tradeFee)                       // trade fee processed post settlement
            .sub(Fixed6Lib.from(self.settlementFee))  // settlement / liquidation fee processed post settlement
            .add(self.transfer)                       // deposit / withdrawal processed post settlement
            .add(result.collateral);                  // incorporate collateral change at this settlement
        self.transfer = order.collateral;
        self.tradeFee = result.linearFee.add(result.proportionalFee).add(result.adiabaticFee);
        self.settlementFee = result.settlementFee.add(result.liquidationFee);
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

/// @dev Manually encodes and decodes the Checkpoint struct into storage.
///
///     struct StoredCheckpoint {
///         /* slot 0 */
///         int48 tradeFee;
///         uint48 settlementFee;
///         int64 transfer;
///         int64 collateral;
///     }
///
library CheckpointStorageLib {
    // sig: 0xba85116a
    error CheckpointStorageInvalidError();

    function read(CheckpointStorage storage self) internal view returns (Checkpoint memory) {
        uint256 slot0 = self.slot0;
        return Checkpoint(
            Fixed6.wrap(int256(slot0 << (256 - 48)) >> (256 - 48)),
            UFixed6.wrap(uint256(slot0 << (256 - 48 - 48)) >> (256 - 48)),
            Fixed6.wrap(int256(slot0 << (256 - 48 - 48 - 64)) >> (256 - 64)),
            Fixed6.wrap(int256(slot0 << (256 - 48 - 48 - 64 - 64)) >> (256 - 64))
        );
    }

    function store(CheckpointStorage storage self, Checkpoint memory newValue) internal {
        if (newValue.tradeFee.gt(Fixed6.wrap(type(int48).max))) revert CheckpointStorageInvalidError();
        if (newValue.tradeFee.lt(Fixed6.wrap(type(int48).min))) revert CheckpointStorageInvalidError();
        if (newValue.settlementFee.gt(UFixed6.wrap(type(uint48).max))) revert CheckpointStorageInvalidError();
        if (newValue.transfer.gt(Fixed6.wrap(type(int64).max))) revert CheckpointStorageInvalidError();
        if (newValue.transfer.lt(Fixed6.wrap(type(int64).min))) revert CheckpointStorageInvalidError();
        if (newValue.collateral.gt(Fixed6.wrap(type(int64).max))) revert CheckpointStorageInvalidError();
        if (newValue.collateral.lt(Fixed6.wrap(type(int64).min))) revert CheckpointStorageInvalidError();

        uint256 encoded0 =
            uint256(Fixed6.unwrap(newValue.tradeFee)        << (256 - 48)) >> (256 - 48) |
            uint256(UFixed6.unwrap(newValue.settlementFee)  << (256 - 48)) >> (256 - 48 - 48) |
            uint256(Fixed6.unwrap(newValue.transfer)        << (256 - 64)) >> (256 - 48 - 48 - 64) |
            uint256(Fixed6.unwrap(newValue.collateral)      << (256 - 64)) >> (256 - 48 - 48 - 64 - 64);

        assembly {
            sstore(self.slot, encoded0)
        }
    }
}
