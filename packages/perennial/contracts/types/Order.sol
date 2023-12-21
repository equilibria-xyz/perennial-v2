// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "./OracleVersion.sol";
import "./RiskParameter.sol";
import "./MarketParameter.sol";
import "./Position.sol";

/// @dev Order type
struct Order {
    /// @dev The change in the maker position
    Fixed6 maker;

    /// @dev The change in the long position
    Fixed6 long;

    /// @dev The change in the short position
    Fixed6 short;

    /// @dev The change in the net position
    Fixed6 net;

    /// @dev The change in the efficiency
    Fixed6 efficiency;
    
    /// @dev The latest unscaled skew
    Fixed6 latestSkew;

    /// @dev The latest unscaled skew
    Fixed6 currentSkew;

    /// @dev The fee for the order
    Fixed6 fee;

    /// @dev The fixed settlement fee for the order
    UFixed6 keeper;
}
using OrderLib for Order global;

/// @title Order
/// @notice Holds the state for an account's update order
library OrderLib {
    /// @notice Computes and sets the fee and keeper once an order is already created
    /// @param self The Order object to update
    /// @param latestVersion The latest oracle version
    /// @param marketParameter The market parameter
    /// @param riskParameter The risk parameter
    function registerFee(
        Order memory self,
        OracleVersion memory latestVersion,
        MarketParameter memory marketParameter,
        RiskParameter memory riskParameter
    ) internal pure {
        Fixed6 fee = Fixed6Lib.from(latestVersion.price.abs())

            // taker fee
            .mul(_calculateFee(
                self.latestSkew,
                self.currentSkew,
                self.long.abs().add(self.short.abs()),
                riskParameter.takerFee,
                riskParameter.takerImpactFee,
                riskParameter.takerSkewFee,
                riskParameter.skewScale

            // maker fee
            ).add(_calculateFee(
                self.maker.gt(Fixed6Lib.ZERO) ? self.currentSkew : Fixed6Lib.ZERO,
                self.maker.lt(Fixed6Lib.ZERO) ? self.currentSkew : Fixed6Lib.ZERO,
                self.maker.abs(),
                riskParameter.makerFee,
                riskParameter.makerImpactFee,
                UFixed6Lib.ZERO, // TODO: add
                riskParameter.skewScale
            )));

        self.fee = marketParameter.closed ? Fixed6Lib.ZERO : fee;
        self.keeper = isEmpty(self) ? UFixed6Lib.ZERO : marketParameter.settlementFee;
    }

    // TODO: natspec
    function _calculateFee(
        Fixed6 latestSkew,
        Fixed6 currentSkew,
        UFixed6 orderMagnitude,
        UFixed6 baseFee,
        UFixed6 impactFee,
        UFixed6 magnitudeFee,
        UFixed6 skewScale
    ) private pure returns (Fixed6) {
        UFixed6 orderMagnitudeScaled = orderMagnitude.unsafeDiv(skewScale);
        Fixed6 skewAUC = latestSkew.add(currentSkew).unsafeDiv(Fixed6Lib.from(skewScale)).div(Fixed6Lib.from(2));
        Fixed6 orderMagnitudeSkew = currentSkew.sub(latestSkew);
        
        // base fee
        return Fixed6Lib.from(baseFee.mul(orderMagnitude))
            // impact fee
            .add(Fixed6Lib.from(impactFee).mul(skewAUC).mul(orderMagnitudeSkew))
            // magnitude fee
            .add(Fixed6Lib.from(magnitudeFee.mul(orderMagnitudeScaled).mul(orderMagnitude)));
    }

    /// @notice Returns whether the order increases any of the account's positions
    /// @return Whether the order increases any of the account's positions
    function increasesPosition(Order memory self) internal pure returns (bool) {
        return increasesMaker(self) || increasesTaker(self);
    }

    /// @notice Returns whether the order increases the account's long or short positions
    /// @return Whether the order increases the account's long or short positions
    function increasesTaker(Order memory self) internal pure returns (bool) {
        return self.long.gt(Fixed6Lib.ZERO) || self.short.gt(Fixed6Lib.ZERO);
    }

    /// @notice Returns whether the order increases the account's maker position
    /// @return Whether the order increases the account's maker positions
    function increasesMaker(Order memory self) internal pure returns (bool) {
        return self.maker.gt(Fixed6Lib.ZERO);
    }

    /// @notice Returns whether the order decreases the liquidity of the market
    /// @return Whether the order decreases the liquidity of the market
    function decreasesLiquidity(Order memory self) internal pure returns (bool) {
        return self.maker.lt(self.net);
    }

    /// @notice Returns the whether the position is single-sided
    /// @param self The position object to check
    /// @param currentPosition The current position to check
    /// @return Whether the position is single-sided
    function singleSided(Order memory self, Position memory currentPosition) internal pure returns (bool) {
        return (self.maker.isZero() && self.long.isZero() && currentPosition.maker.isZero() && currentPosition.long.isZero()) ||
            (self.long.isZero() && self.short.isZero() && currentPosition.long.isZero() && currentPosition.short.isZero()) ||
            (self.short.isZero() && self.maker.isZero() && currentPosition.short.isZero() && currentPosition.maker.isZero());
    }

    /// @notice Returns whether the order is applicable for liquidity checks
    /// @param self The Order object to check
    /// @param marketParameter The market parameter
    /// @return Whether the order is applicable for liquidity checks
    function liquidityCheckApplicable(
        Order memory self,
        MarketParameter memory marketParameter
    ) internal pure returns (bool) {
        return !marketParameter.closed &&
            ((self.maker.isZero()) || !marketParameter.makerCloseAlways || increasesMaker(self)) &&
            ((self.long.isZero() && self.short.isZero()) || !marketParameter.takerCloseAlways || increasesTaker(self));
    }

    /// @notice Returns the liquidation fee of the position
    /// @dev Assumes the order must be single-sided
    /// @param self The position object to check
    /// @param latestVersion The latest oracle version
    /// @param riskParameter The current risk parameter
    /// @return The liquidation fee of the position
    function liquidationFee(
        Order memory self,
        OracleVersion memory latestVersion,
        RiskParameter memory riskParameter
    ) internal pure returns (UFixed6) {
        if (isEmpty(self)) return UFixed6Lib.ZERO;

        UFixed6 partialMaintenance = magnitude(self).abs()
            .mul(latestVersion.price.abs())
            .mul(riskParameter.maintenance)
            .max(riskParameter.minMaintenance);

        return partialMaintenance.mul(riskParameter.liquidationFee)
            .min(riskParameter.maxLiquidationFee)
            .max(riskParameter.minLiquidationFee);
    }

    /// @notice Returns whether the order has no position change
    /// @dev Assumes the order must be single-sided
    /// @param self The Order object to check
    /// @return Whether the order has no position change
    function isEmpty(Order memory self) internal pure returns (bool) {
        return magnitude(self).isZero();
    }

    /// @notice Returns the amount of the non-zero side of the order
    /// @dev Assumes the order must be single-sided
    /// @param self The Order object to check
    /// @return The magnitude of the order
    function magnitude(Order memory self) internal pure returns (Fixed6) {
        return self.maker.add(self.long).add(self.short);
    }
}
