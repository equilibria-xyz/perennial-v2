// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { Fixed6, Fixed6Lib } from "@equilibria/root/number/types/Fixed6.sol";
import { IMarket } from "../interfaces/IMarket.sol";

/// @title MagicValueLib
/// @dev (external-safe): this library is safe to externalize
/// @notice Manages the logic for the update parameter magic values
library MagicValueLib {
    Fixed6 private constant MAGIC_VALUE_WITHDRAW_ALL_COLLATERAL = Fixed6.wrap(type(int256).min);
    UFixed6 private constant MAGIC_VALUE_UNCHANGED_POSITION = UFixed6.wrap(type(uint256).max);
    UFixed6 private constant MAGIC_VALUE_FULLY_CLOSED_POSITION = UFixed6.wrap(type(uint256).max - 1);

    function process(
        IMarket.Context memory context,
        IMarket.UpdateContext memory updateContext,
        Fixed6 collateral,
        UFixed6 newMaker,
        UFixed6 newLong,
        UFixed6 newShort
    ) internal pure returns (Fixed6, UFixed6, UFixed6, UFixed6) {
        return (
            _processCollateralMagicValue(context, collateral),
            _processPositionMagicValue(context, updateContext.currentPositionLocal.maker, newMaker),
            _processPositionMagicValue(context, updateContext.currentPositionLocal.long, newLong),
            _processPositionMagicValue(context, updateContext.currentPositionLocal.short, newShort)
        );
    }

    /// @notice Modifies the collateral input per magic values
    /// @param context The context to use
    /// @param collateral The collateral to process
    /// @return The resulting collateral value
    function _processCollateralMagicValue(
        IMarket.Context memory context,
        Fixed6 collateral
    ) private pure returns (Fixed6) {
        return collateral.eq(MAGIC_VALUE_WITHDRAW_ALL_COLLATERAL) ?
            context.local.collateral.mul(Fixed6Lib.NEG_ONE) :
            collateral;
    }

    /// @notice Modifies the position input per magic values
    /// @param context The context to use
    /// @param currentPosition The current position prior to update
    /// @param newPosition The position to process
    /// @return The resulting position value
    function _processPositionMagicValue(
        IMarket.Context memory context,
        UFixed6 currentPosition,
        UFixed6 newPosition
    ) private pure returns (UFixed6) {
        if (newPosition.eq(MAGIC_VALUE_UNCHANGED_POSITION)) return currentPosition;
        if (newPosition.eq(MAGIC_VALUE_FULLY_CLOSED_POSITION)) {
            if (context.pendingLocal.crossesZero()) return currentPosition; // pending zero-cross, max close is no-op
            return context.pendingLocal.pos().min(currentPosition);         // minimum position is pending open, or current position if smaller (due to intents)
        }
        return newPosition;
    }
}
