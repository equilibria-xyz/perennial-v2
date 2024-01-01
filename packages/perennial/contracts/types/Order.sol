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

    /// @dev The latest global maker amount
    UFixed6 latestMaker;

    /// @dev The socialization fee for the order
    Fixed6 socialization;

    /// @dev The fee charged locally on order creation
    Fixed6 preFee;

    /// @dev The fee charged globally on order settlement
    Fixed6 postFee;

    /// @dev The fixed settlement fee for the order
    UFixed6 settlementFee;
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
    /// @param protected Whether the order is protected
    function registerFee(
        Order memory self,
        OracleVersion memory latestVersion,
        MarketParameter memory marketParameter,
        RiskParameter memory riskParameter,
        bool protected
    ) internal pure {
        UFixed6 magnitudeFee = _calculateMagnitudeFee(
            self.maker.isZero() ? self.long.add(self.short).abs() : self.maker.abs(),
            self.maker.isZero() ? riskParameter.takerFee : riskParameter.makerFee,
            self.maker.isZero() ? riskParameter.takerMagnitudeFee : riskParameter.makerMagnitudeFee,
            riskParameter.skewScale
        );
        Fixed6 impactFee = _calculateImpactFee(
            self.latestSkew,
            self.currentSkew,
            self.currentSkew.sub(self.latestSkew), // only charge impact fee on non-socialized portion
            riskParameter.impactFee,
            riskParameter.skewScale
        );
        Fixed6 makerFee = _calculateMakerFee(
            self.currentSkew,
            self.maker,
            self.latestMaker,
            riskParameter.impactFee,
            riskParameter.skewScale
        );

        bool makerPaysImpact = self.maker.isZero() || protected;
        Fixed6 orderFee = Fixed6Lib.from(latestVersion.price.abs())
            .mul(Fixed6Lib.from(magnitudeFee).add(makerPaysImpact ? impactFee : Fixed6Lib.ZERO).add(makerFee));
        Fixed6 takerSocializationFee = Fixed6Lib.from(latestVersion.price.abs())
            .mul(makerPaysImpact ? Fixed6Lib.ZERO : impactFee);

        self.postFee = marketParameter.closed ? Fixed6Lib.ZERO : takerSocializationFee;
        self.preFee = marketParameter.closed ? Fixed6Lib.ZERO : orderFee;
        self.settlementFee = isEmpty(self) ? UFixed6Lib.ZERO : marketParameter.settlementFee;
    }

    /// @notice Calculates the maker fee
    /// @param currentSkew The current skew
    /// @param orderMaker The maker amount of the order
    /// @param totalMaker The latest global maker amount
    /// @param impactFee The impact fee
    /// @param skewScale The skew scale
    /// @return The maker fee
    function _calculateMakerFee(
        Fixed6 currentSkew,
        Fixed6 orderMaker,
        UFixed6 totalMaker,
        UFixed6 impactFee,
        UFixed6 skewScale
    ) private pure returns (Fixed6) {
        Fixed6 totalTakerFee = _calculateImpactFee(
            Fixed6Lib.ZERO,
            currentSkew, // TODO: use current or latest?
            currentSkew, // TODO: do maker soc. movements affect the adiabaticness of this?
            impactFee,
            skewScale
        );

        return totalTakerFee.muldiv(orderMaker.mul(Fixed6Lib.NEG_ONE), Fixed6Lib.from(totalMaker));
    }

    /// @notice Calculates the impact fee
    /// @param latestSkew The latest skew
    /// @param currentSkew The current skew
    /// @param orderImpact The order impact
    /// @param impactFee The impact fee
    /// @param skewScale The skew scale
    /// @return The impact fee
    function _calculateImpactFee(
        Fixed6 latestSkew,
        Fixed6 currentSkew,
        Fixed6 orderImpact,
        UFixed6 impactFee,
        UFixed6 skewScale
    ) private pure returns (Fixed6) {
        Fixed6 skewAUC = latestSkew.add(currentSkew).unsafeDiv(Fixed6Lib.from(skewScale)).div(Fixed6Lib.from(2));
        return Fixed6Lib.from(impactFee).mul(skewAUC).mul(orderImpact);
    }

    /// @notice Calculates the magnitude fee
    /// @param orderMagnitude The order magnitude
    /// @param baseFee The base fee
    /// @param magnitudeFee The magnitude fee
    /// @param skewScale The skew scale
    /// @return The magnitude fee
    function _calculateMagnitudeFee(
        UFixed6 orderMagnitude,
        UFixed6 baseFee,
        UFixed6 magnitudeFee,
        UFixed6 skewScale
    ) private pure returns (UFixed6) {
        UFixed6 orderMagnitudeScaled = orderMagnitude.unsafeDiv(skewScale);
        return baseFee.add(magnitudeFee.mul(orderMagnitudeScaled)).mul(orderMagnitude);
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
