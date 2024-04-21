// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/accumulator/types/Accumulator6.sol";
import "@equilibria/root/accumulator/types/UAccumulator6.sol";
import "../types/ProtocolParameter.sol";
import "../types/MarketParameter.sol";
import "../types/RiskParameter.sol";
import "../types/Global.sol";
import "../types/Position.sol";
import "../types/Version.sol";

/// @dev The result of the version accumulation
struct VersionAccumulationResult {
    UFixed6 tradeFee;
    UFixed6 subtractiveFee;

    Fixed6 tradeOffset;
    Fixed6 tradeOffsetMaker;
    UFixed6 tradeOffsetMarket;

    Fixed6 adiabaticExposure;
    Fixed6 adiabaticExposureMaker;
    Fixed6 adiabaticExposureMarket;

    Fixed6 fundingMaker;
    Fixed6 fundingLong;
    Fixed6 fundingShort;
    UFixed6 fundingFee;

    Fixed6 interestMaker;
    Fixed6 interestLong;
    Fixed6 interestShort;
    UFixed6 interestFee;

    Fixed6 pnlMaker;
    Fixed6 pnlLong;
    Fixed6 pnlShort;

    UFixed6 settlementFee;
    UFixed6 liquidationFee;
}

/// @dev The in-memory context for the version accumulation
struct VersionAccumulationContext {
    Global global;
    Position fromPosition;
    Order order;
    Intent intent;
    OracleVersion fromOracleVersion;
    OracleVersion toOracleVersion;
    MarketParameter marketParameter;
    RiskParameter riskParameter;
}

/// @title VersionLib
/// @notice Manages the logic for the global order accumualation
library VersionLib {
    /// @notice Accumulates the global state for the period from `fromVersion` to `toOracleVersion`
    /// @param self The Version object to update
    /// @param context The accumulation context
    /// @return next The accumulated version
    /// @return nextGlobal The next global state
    /// @return result The accumulation result
    function accumulate(
        Version memory self,
        VersionAccumulationContext memory context
    ) external pure returns (Version memory next, Global memory nextGlobal, VersionAccumulationResult memory result) {
        // setup next accumulators
        _next(self, next);

        // record oracle version
        (next.valid, next.price) = (context.toOracleVersion.valid, context.toOracleVersion.price);

        // accumulate settlement fee
        result.settlementFee = _accumulateSettlementFee(next, context);

        // accumulate liquidation fee
        result.liquidationFee = _accumulateLiquidationFee(next, context);

        // accumulate fee
        _accumulateFee(next, context, result);

        // accumulate linear fee
        _accumulateLinearFee(next, context, result);

        // accumulate proportional fee
        _accumulateProportionalFee(next, context, result);

        // accumulate adiabatic exposure
        _accumulateAdiabaticExposure(next, context, result);

        // accumulate adiabatic fee
        _accumulateAdiabaticFee(next, context, result);

        // if closed, don't accrue anything else
        if (context.marketParameter.closed) return (next, context.global, result);

        // accumulate funding
        (result.fundingMaker, result.fundingLong, result.fundingShort, result.fundingFee) =
            _accumulateFunding(next, context);

        // accumulate interest
        (result.interestMaker, result.interestLong, result.interestShort, result.interestFee) =
            _accumulateInterest(next, context);

        // accumulate P&L
        (result.pnlMaker, result.pnlLong, result.pnlShort) = _accumulatePNL(next, context);

        return (next, context.global, result);
    }

    /// @notice Copies over the version-over-version accumulators to prepare the next version
    /// @param self The Version object to update
    function _next(Version memory self, Version memory next) internal pure {
        next.makerValue._value = self.makerValue._value;
        next.longValue._value = self.longValue._value;
        next.shortValue._value = self.shortValue._value;
    }

    /// @notice Globally accumulates settlement fees since last oracle update
    /// @param next The Version object to update
    /// @param context The accumulation context
    function _accumulateSettlementFee(
        Version memory next,
        VersionAccumulationContext memory context
    ) private pure returns (UFixed6 settlementFee) {
        uint256 orders = context.order.orders - context.intent.intents;
        settlementFee = orders == 0 ? UFixed6Lib.ZERO : context.marketParameter.settlementFee;
        next.settlementFee.decrement(Fixed6Lib.from(settlementFee), UFixed6Lib.from(orders));
    }

    /// @notice Globally accumulates hypothetical liquidation fee since last oracle update
    /// @param next The Version object to update
    /// @param context The accumulation context
    function _accumulateLiquidationFee(
        Version memory next,
        VersionAccumulationContext memory context
    ) private pure returns (UFixed6 liquidationFee) {
        liquidationFee = context.toOracleVersion.valid ? context.riskParameter.liquidationFee : UFixed6Lib.ZERO;
        next.liquidationFee.decrement(Fixed6Lib.from(liquidationFee), UFixed6Lib.ONE);
    }

    /// @notice Globally accumulates linear fees since last oracle update
    /// @param next The Version object to update
    /// @param context The accumulation context
    function _accumulateFee(
        Version memory next,
        VersionAccumulationContext memory context,
        VersionAccumulationResult memory result
    ) private pure {
        UFixed6 makerFee = context.order.makerTotal()
            .mul(context.toOracleVersion.price.abs())
            .mul(context.marketParameter.makerFee);
        next.makerFee.decrement(Fixed6Lib.from(makerFee), context.order.makerTotal());
        UFixed6 makerSubtractiveFee = context.order.makerTotal().isZero() ?
            UFixed6Lib.ZERO :
            makerFee.muldiv(context.order.makerReferral, context.order.makerTotal());

        UFixed6 takerFee = context.order.takerTotal()
            .mul(context.toOracleVersion.price.abs())
            .mul(context.marketParameter.takerFee);
        next.takerFee.decrement(Fixed6Lib.from(takerFee), context.order.takerTotal());
        UFixed6 takerSubtractiveFee = context.order.takerTotal().isZero() ?
            UFixed6Lib.ZERO :
            takerFee.muldiv(context.order.takerReferral, context.order.takerTotal());

        result.tradeFee = result.tradeFee.add(makerFee).add(takerFee).sub(makerSubtractiveFee).sub(takerSubtractiveFee);
        result.subtractiveFee = result.subtractiveFee.add(makerSubtractiveFee).add(takerSubtractiveFee);
    }

    /// @notice Globally accumulates linear fees since last oracle update
    /// @param next The Version object to update
    /// @param context The accumulation context
    function _accumulateLinearFee(
        Version memory next,
        VersionAccumulationContext memory context,
        VersionAccumulationResult memory result
    ) private pure {
        UFixed6 makerLinearFee = context.riskParameter.makerFee.linear(
            Fixed6Lib.from(context.order.makerTotal()),
            context.toOracleVersion.price.abs()
        );
        next.makerOffset.decrement(Fixed6Lib.from(makerLinearFee), context.order.makerTotal());

        UFixed6 takerPosTotal = context.order.takerPos().sub(context.intent.takerPos);
        UFixed6 takerPosLinearFee = context.riskParameter.takerFee.linear(
            Fixed6Lib.from(takerPosTotal),
            context.toOracleVersion.price.abs()
        );
        next.takerPosOffset.decrement(Fixed6Lib.from(takerPosLinearFee), takerPosTotal);

        UFixed6 takerNegTotal = context.order.takerNeg().sub(context.intent.takerNeg);
        UFixed6 takerNegLinearFee = context.riskParameter.takerFee.linear(
            Fixed6Lib.from(takerNegTotal),
            context.toOracleVersion.price.abs()
        );
        next.takerNegOffset.decrement(Fixed6Lib.from(takerNegLinearFee), takerNegTotal);

        UFixed6 linearFee = makerLinearFee.add(takerPosLinearFee).add(takerNegLinearFee);
        UFixed6 marketFee = context.fromPosition.maker.isZero() ? linearFee : UFixed6Lib.ZERO;
        UFixed6 makerFee = linearFee.sub(marketFee);
        next.makerValue.increment(Fixed6Lib.from(makerFee), context.fromPosition.maker);

        result.tradeOffset = result.tradeOffset.add(Fixed6Lib.from(linearFee));
        result.tradeOffsetMaker = result.tradeOffsetMaker.add(Fixed6Lib.from(makerFee));
        result.tradeOffsetMarket = result.tradeOffsetMarket.add(marketFee);
    }

    /// @notice Globally accumulates proportional fees since last oracle update
    /// @param next The Version object to update
    /// @param context The accumulation context
    function _accumulateProportionalFee(
        Version memory next,
        VersionAccumulationContext memory context,
        VersionAccumulationResult memory result
    ) private pure {
        UFixed6 makerProportionalFee = context.riskParameter.makerFee.proportional(
            Fixed6Lib.from(context.order.makerTotal()),
            context.toOracleVersion.price.abs()
        );
        next.makerOffset.decrement(Fixed6Lib.from(makerProportionalFee), context.order.makerTotal());

        UFixed6 takerPos = context.order.takerPos().sub(context.intent.takerPos);
        UFixed6 takerPosProportionalFee = context.riskParameter.takerFee.proportional(
            Fixed6Lib.from(takerPos),
            context.toOracleVersion.price.abs()
        );
        next.takerPosOffset.decrement(Fixed6Lib.from(takerPosProportionalFee), takerPos);

        UFixed6 takerNeg = context.order.takerNeg().sub(context.intent.takerNeg);
        UFixed6 takerNegProportionalFee = context.riskParameter.takerFee.proportional(
            Fixed6Lib.from(takerNeg),
            context.toOracleVersion.price.abs()
        );
        next.takerNegOffset.decrement(Fixed6Lib.from(takerNegProportionalFee), takerNeg);

        UFixed6 proportionalFee = makerProportionalFee.add(takerPosProportionalFee).add(takerNegProportionalFee);
        UFixed6 marketFee = context.fromPosition.maker.isZero() ? proportionalFee : UFixed6Lib.ZERO;
        UFixed6 makerFee = proportionalFee.sub(marketFee);
        next.makerValue.increment(Fixed6Lib.from(makerFee), context.fromPosition.maker);

        result.tradeOffset = result.tradeOffset.add(Fixed6Lib.from(proportionalFee));
        result.tradeOffsetMaker = result.tradeOffsetMaker.add(Fixed6Lib.from(makerFee));
        result.tradeOffsetMarket = result.tradeOffsetMarket.add(marketFee);
    }

    /// @notice Globally accumulates adiabatic fees since last oracle update
    /// @param next The Version object to update
    /// @param context The accumulation context
    function _accumulateAdiabaticFee(
        Version memory next,
        VersionAccumulationContext memory context,
        VersionAccumulationResult memory result
    ) private pure {
        Fixed6 adiabaticFee;

        // position fee from positive skew taker orders
        UFixed6 takerPos = context.order.takerPos().sub(context.intent.takerPos);
        adiabaticFee = context.riskParameter.takerFee.adiabatic(
            context.fromPosition.skew(),
            Fixed6Lib.from(takerPos),
            context.toOracleVersion.price.abs()
        );
        next.takerPosOffset.decrement(adiabaticFee, takerPos);
        result.tradeOffset = result.tradeOffset.add(adiabaticFee);

        // position fee from negative skew taker orders
        UFixed6 takerNeg = context.order.takerNeg().sub(context.intent.takerNeg);
        adiabaticFee = context.riskParameter.takerFee.adiabatic(
            context.fromPosition.skew().add(Fixed6Lib.from(takerPos)),
            Fixed6Lib.from(-1, takerNeg),
            context.toOracleVersion.price.abs()
        );
        next.takerNegOffset.decrement(adiabaticFee, takerNeg);
        result.tradeOffset = result.tradeOffset.add(adiabaticFee);
    }

    /// @notice Globally accumulates single component of the position fees exposure since last oracle update
    /// @param next The Version object to update
    /// @param context The accumulation context
    /// @param result The accumulation result
    function _accumulateAdiabaticExposure(
        Version memory next,
        VersionAccumulationContext memory context,
        VersionAccumulationResult memory result
    ) private pure {
        Fixed6 exposure = context.riskParameter.takerFee.exposure(context.fromPosition.skew());

        Fixed6 adiabaticExposure = context.toOracleVersion.price.sub(context.fromOracleVersion.price).mul(exposure);
        Fixed6 adiabaticExposureMaker = adiabaticExposure.mul(Fixed6Lib.NEG_ONE);
        Fixed6 adiabaticExposureMarket = context.fromPosition.maker.isZero() ? adiabaticExposureMaker : Fixed6Lib.ZERO;
        adiabaticExposureMaker = adiabaticExposureMaker.sub(adiabaticExposureMarket);
        next.makerValue.increment(adiabaticExposureMaker, context.fromPosition.maker);

        result.adiabaticExposure = adiabaticExposure;
        result.adiabaticExposureMarket = adiabaticExposureMarket;
        result.adiabaticExposureMaker = adiabaticExposureMaker;
    }

    /// @notice Globally accumulates all long-short funding since last oracle update
    /// @param next The Version object to update
    /// @param context The accumulation context
    /// @return fundingMaker The total funding accrued by makers
    /// @return fundingLong The total funding accrued by longs
    /// @return fundingShort The total funding accrued by shorts
    /// @return fundingFee The total fee accrued from funding accumulation
    function _accumulateFunding(Version memory next, VersionAccumulationContext memory context) private pure returns (
        Fixed6 fundingMaker,
        Fixed6 fundingLong,
        Fixed6 fundingShort,
        UFixed6 fundingFee
    ) {
        Fixed6 toSkew = context.toOracleVersion.valid ?
            context.fromPosition.skew().add(context.order.long()).sub(context.order.short()) :
            context.fromPosition.skew();

        // Compute long-short funding rate
        Fixed6 funding = context.global.pAccumulator.accumulate(
            context.riskParameter.pController,
            toSkew.unsafeDiv(Fixed6Lib.from(context.riskParameter.takerFee.scale)).min(Fixed6Lib.ONE).max(Fixed6Lib.NEG_ONE),
            context.fromOracleVersion.timestamp,
            context.toOracleVersion.timestamp,
            context.fromPosition.takerSocialized().mul(context.fromOracleVersion.price.abs())
        );

        // Handle maker receive-only status
        if (context.riskParameter.makerReceiveOnly && funding.sign() != context.fromPosition.skew().sign())
            funding = funding.mul(Fixed6Lib.NEG_ONE);

        // Initialize long and short funding
        (fundingLong, fundingShort) = (Fixed6Lib.NEG_ONE.mul(funding), funding);

        // Compute fee spread
        fundingFee = funding.abs().mul(context.marketParameter.fundingFee);
        Fixed6 fundingSpread = Fixed6Lib.from(fundingFee).div(Fixed6Lib.from(2));

        // Adjust funding with spread
        (fundingLong, fundingShort) = (
            fundingLong.sub(Fixed6Lib.from(fundingFee)).add(fundingSpread),
            fundingShort.sub(fundingSpread)
        );

        // Redirect net portion of minor's side to maker
        if (context.fromPosition.long.gt(context.fromPosition.short)) {
            fundingMaker = fundingShort.mul(Fixed6Lib.from(context.fromPosition.socializedMakerPortion()));
            fundingShort = fundingShort.sub(fundingMaker);
        }
        if (context.fromPosition.short.gt(context.fromPosition.long)) {
            fundingMaker = fundingLong.mul(Fixed6Lib.from(context.fromPosition.socializedMakerPortion()));
            fundingLong = fundingLong.sub(fundingMaker);
        }

        next.makerValue.increment(fundingMaker, context.fromPosition.maker);
        next.longValue.increment(fundingLong, context.fromPosition.long);
        next.shortValue.increment(fundingShort, context.fromPosition.short);
    }

    /// @notice Globally accumulates all maker interest since last oracle update
    /// @param next The Version object to update
    /// @param context The accumulation context
    /// @return interestMaker The total interest accrued by makers
    /// @return interestLong The total interest accrued by longs
    /// @return interestShort The total interest accrued by shorts
    /// @return interestFee The total fee accrued from interest accumulation
    function _accumulateInterest(
        Version memory next,
        VersionAccumulationContext memory context
    ) private pure returns (Fixed6 interestMaker, Fixed6 interestLong, Fixed6 interestShort, UFixed6 interestFee) {
        UFixed6 notional = context.fromPosition.long.add(context.fromPosition.short).min(context.fromPosition.maker).mul(context.fromOracleVersion.price.abs());

        // Compute maker interest
        UFixed6 interest = context.riskParameter.utilizationCurve.accumulate(
            context.fromPosition.utilization(context.riskParameter),
            context.fromOracleVersion.timestamp,
            context.toOracleVersion.timestamp,
            notional
        );

        // Compute fee
        interestFee = interest.mul(context.marketParameter.interestFee);

        // Adjust long and short funding with spread
        interestLong = Fixed6Lib.from(
            context.fromPosition.major().isZero() ?
            interest :
            interest.muldiv(context.fromPosition.long, context.fromPosition.long.add(context.fromPosition.short))
        );
        interestShort = Fixed6Lib.from(interest).sub(interestLong);
        interestMaker = Fixed6Lib.from(interest.sub(interestFee));

        interestLong = interestLong.mul(Fixed6Lib.NEG_ONE);
        interestShort = interestShort.mul(Fixed6Lib.NEG_ONE);
        next.makerValue.increment(interestMaker, context.fromPosition.maker);
        next.longValue.increment(interestLong, context.fromPosition.long);
        next.shortValue.increment(interestShort, context.fromPosition.short);
    }

    /// @notice Globally accumulates position profit & loss since last oracle update
    /// @param next The Version object to update
    /// @param context The accumulation context
    /// @return pnlMaker The total pnl accrued by makers
    /// @return pnlLong The total pnl accrued by longs
    /// @return pnlShort The total pnl accrued by shorts
    function _accumulatePNL(
        Version memory next,
        VersionAccumulationContext memory context
    ) private pure returns (Fixed6 pnlMaker, Fixed6 pnlLong, Fixed6 pnlShort) {
        pnlLong = context.toOracleVersion.price.sub(context.fromOracleVersion.price)
            .mul(Fixed6Lib.from(context.fromPosition.longSocialized()));
        pnlShort = context.fromOracleVersion.price.sub(context.toOracleVersion.price)
            .mul(Fixed6Lib.from(context.fromPosition.shortSocialized()));
        pnlMaker = pnlLong.add(pnlShort).mul(Fixed6Lib.NEG_ONE);

        next.longValue.increment(pnlLong, context.fromPosition.long);
        next.shortValue.increment(pnlShort, context.fromPosition.short);
        next.makerValue.increment(pnlMaker, context.fromPosition.maker);
    }
}
