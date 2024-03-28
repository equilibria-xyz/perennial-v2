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

/// @dev Individual accumulation values
struct VersionAccumulationResult {
    UFixed6 positionFee;
    UFixed6 positionFeeMaker;
    UFixed6 positionFeeProtocol;
    UFixed6 positionFeeSubtractive;
    Fixed6 positionFeeExposure;
    Fixed6 positionFeeExposureMaker;
    Fixed6 positionFeeExposureProtocol;
    Fixed6 positionFeeImpact;

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

/// @title VersionLib
/// @notice Manages the logic for the global order accumualation
library VersionLib {
    struct AccumulationContext {
        Global global;
        Position fromPosition;
        Order order;
        OracleVersion fromOracleVersion;
        OracleVersion toOracleVersion;
        MarketParameter marketParameter;
        RiskParameter riskParameter;
    }

    /// @notice Accumulates the global state for the period from `fromVersion` to `toOracleVersion`
    /// @param self The Version object to update
    /// @param global The global state
    /// @param fromPosition The previous latest position
    /// @param order The new order
    /// @param fromOracleVersion The previous latest oracle version
    /// @param toOracleVersion The next latest oracle version
    /// @param marketParameter The market parameter
    /// @param riskParameter The risk parameter
    /// @return next The accumulated version
    /// @return nextGlobal The next global state
    /// @return result The accumulation result
    function accumulate(
        Version memory self,
        Global memory global,
        Position memory fromPosition,
        Order memory order,
        OracleVersion memory fromOracleVersion,
        OracleVersion memory toOracleVersion,
        MarketParameter memory marketParameter,
        RiskParameter memory riskParameter
    ) external pure returns (Version memory next, Global memory nextGlobal, VersionAccumulationResult memory result) {
        AccumulationContext memory context = AccumulationContext(
            global,
            fromPosition,
            order,
            fromOracleVersion,
            toOracleVersion,
            marketParameter,
            riskParameter
        );

        // setup next accumulators
        _next(self, next);

        // record validity
        next.valid = toOracleVersion.valid;

        // accumulate settlement fee
        result.settlementFee = _accumulateSettlementFee(next, context);

        // accumulate liquidation fee
        result.liquidationFee = _accumulateLiquidationFee(next, context);

        // accumulate linear fee
        _accumulateLinearFee(next, context, result);

        // accumulate proportional fee
        _accumulateProportionalFee(next, context, result);

        // accumulate adiabatic fee
        _accumulateAdiabaticFee(next, context, result);

        // if closed, don't accrue anything else
        if (marketParameter.closed) return (next, global, result);

        // accumulate funding
        (result.fundingMaker, result.fundingLong, result.fundingShort, result.fundingFee) =
            _accumulateFunding(next, context);

        // accumulate interest
        (result.interestMaker, result.interestLong, result.interestShort, result.interestFee) =
            _accumulateInterest(next, context);

        // accumulate P&L
        (result.pnlMaker, result.pnlLong, result.pnlShort) = _accumulatePNL(next, context);

        return (next, global, result);
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
        AccumulationContext memory context
    ) private pure returns (UFixed6 settlementFee) {
        settlementFee = context.order.orders == 0 ? UFixed6Lib.ZERO : context.marketParameter.settlementFee;
        next.settlementFee.decrement(Fixed6Lib.from(settlementFee), UFixed6Lib.from(context.order.orders));
    }

    /// @notice Globally accumulates hypothetical liquidation fee since last oracle update
    /// @param next The Version object to update
    /// @param context The accumulation context
    function _accumulateLiquidationFee(
        Version memory next,
        AccumulationContext memory context
    ) private pure returns (UFixed6 liquidationFee) {
        liquidationFee = context.toOracleVersion.valid ? context.riskParameter.liquidationFee : UFixed6Lib.ZERO;
        next.liquidationFee.decrement(Fixed6Lib.from(liquidationFee), UFixed6Lib.ONE);
    }

    /// @notice Globally accumulates linear fees since last oracle update
    /// @param next The Version object to update
    /// @param context The accumulation context
    function _accumulateLinearFee(
        Version memory next,
        AccumulationContext memory context,
        VersionAccumulationResult memory result
    ) private pure {
        (UFixed6 makerLinearFee, UFixed6 makerSubtractiveFee) = _accumulateSubtractiveFee(
            context.riskParameter.makerFee.linear(
                Fixed6Lib.from(context.order.makerTotal()),
                context.toOracleVersion.price.abs()
            ),
            context.order.makerTotal(),
            context.order.makerReferral,
            next.makerLinearFee
        );

        (UFixed6 takerLinearFee, UFixed6 takerSubtractiveFee) = _accumulateSubtractiveFee(
            context.riskParameter.takerFee.linear(
                Fixed6Lib.from(context.order.takerTotal()),
                context.toOracleVersion.price.abs()
            ),
            context.order.takerTotal(),
            context.order.takerReferral,
            next.takerLinearFee
        );

        UFixed6 linearFee = makerLinearFee.add(takerLinearFee);

        UFixed6 protocolFee = context.fromPosition.maker.isZero() ?
            linearFee :
            context.marketParameter.positionFee.mul(linearFee);
        UFixed6 positionFeeMaker = linearFee.sub(protocolFee);
        next.makerValue.increment(Fixed6Lib.from(positionFeeMaker), context.fromPosition.maker);

        result.positionFee = result.positionFee.add(linearFee);
        result.positionFeeMaker = result.positionFeeMaker.add(positionFeeMaker);
        result.positionFeeProtocol = result.positionFeeProtocol.add(protocolFee);
        result.positionFeeSubtractive = result.positionFeeSubtractive.add(makerSubtractiveFee).add(takerSubtractiveFee);
    }

    /// @notice Globally accumulates subtractive fees since last oracle update
    /// @param linearFee The linear fee to accumulate
    /// @param total The total order size for the fee
    /// @param referral The referral size for the fee
    /// @param linearFeeAccumulator The accumulator for the linear fee
    /// @return newLinearFee The new linear fee after subtractive fees
    /// @return subtractiveFee The total subtractive fee
    function _accumulateSubtractiveFee(
        UFixed6 linearFee,
        UFixed6 total,
        UFixed6 referral,
        Accumulator6 memory linearFeeAccumulator
    ) private pure returns (UFixed6 newLinearFee, UFixed6 subtractiveFee) {
        linearFeeAccumulator.decrement(Fixed6Lib.from(linearFee), total);
        subtractiveFee = total.isZero() ? UFixed6Lib.ZERO : linearFee.muldiv(referral, total);
        newLinearFee = linearFee.sub(subtractiveFee);
    }

    /// @notice Globally accumulates proportional fees since last oracle update
    /// @param next The Version object to update
    /// @param context The accumulation context
    function _accumulateProportionalFee(
        Version memory next,
        AccumulationContext memory context,
        VersionAccumulationResult memory result
    ) private pure {
        UFixed6 makerProportionalFee = context.riskParameter.makerFee.proportional(
            Fixed6Lib.from(context.order.makerTotal()),
            context.toOracleVersion.price.abs()
        );
        next.makerProportionalFee.decrement(Fixed6Lib.from(makerProportionalFee), context.order.makerTotal());

        UFixed6 takerProportionalFee = context.riskParameter.takerFee.proportional(
            Fixed6Lib.from(context.order.takerTotal()),
            context.toOracleVersion.price.abs()
        );
        next.takerProportionalFee.decrement(Fixed6Lib.from(takerProportionalFee), context.order.takerTotal());

        UFixed6 proportionalFee = makerProportionalFee.add(takerProportionalFee);
        UFixed6 protocolFee = context.fromPosition.maker.isZero() ?
            proportionalFee :
            context.marketParameter.positionFee.mul(proportionalFee);
        UFixed6 positionFeeMaker = proportionalFee.sub(protocolFee);
        next.makerValue.increment(Fixed6Lib.from(positionFeeMaker), context.fromPosition.maker);

        result.positionFee = result.positionFee.add(proportionalFee);
        result.positionFeeMaker = result.positionFeeMaker.add(positionFeeMaker);
        result.positionFeeProtocol = result.positionFeeProtocol.add(protocolFee);
    }

    /// @notice Globally accumulates adiabatic fees since last oracle update
    /// @param next The Version object to update
    /// @param context The accumulation context
    function _accumulateAdiabaticFee(
        Version memory next,
        AccumulationContext memory context,
        VersionAccumulationResult memory result
    ) private pure {
        Fixed6 exposure = context.riskParameter.takerFee.exposure(context.fromPosition.skew())
            .add(context.riskParameter.makerFee.exposure(context.fromPosition.maker));

        _accumulatePositionFeeComponentExposure(next, context, result, exposure);

        Fixed6 adiabaticFee;

        // position fee from positive skew taker orders
        adiabaticFee = context.riskParameter.takerFee.adiabatic(
            context.fromPosition.skew(),
            Fixed6Lib.from(context.order.takerPos()),
            context.toOracleVersion.price.abs()
        );
        next.takerPosFee.decrement(adiabaticFee, context.order.takerPos());
        result.positionFeeImpact = result.positionFeeImpact.add(adiabaticFee);

        // position fee from negative skew taker orders
        adiabaticFee = context.riskParameter.takerFee.adiabatic(
            context.fromPosition.skew().add(Fixed6Lib.from(context.order.takerPos())),
            Fixed6Lib.from(-1, context.order.takerNeg()),
            context.toOracleVersion.price.abs()
        );
        next.takerNegFee.decrement(adiabaticFee, context.order.takerNeg());
        result.positionFeeImpact = result.positionFeeImpact.add(adiabaticFee);

        // position fee from negative skew maker orders
        adiabaticFee = context.riskParameter.makerFee.adiabatic(
            context.fromPosition.maker,
            Fixed6Lib.from(-1, context.order.makerNeg),
            context.toOracleVersion.price.abs()
        );
        next.makerNegFee.decrement(adiabaticFee, context.order.makerNeg);
        result.positionFeeImpact = result.positionFeeImpact.add(adiabaticFee);

        // position fee from positive skew maker orders
        adiabaticFee = context.riskParameter.makerFee.adiabatic(
            context.fromPosition.maker.sub(context.order.makerNeg),
            Fixed6Lib.from(context.order.makerPos),
            context.toOracleVersion.price.abs()
        );
        next.makerPosFee.decrement(adiabaticFee, context.order.makerPos);
        result.positionFeeImpact = result.positionFeeImpact.add(adiabaticFee);
    }

    /// @notice Globally accumulates single component of the position fees exposure since last oracle update
    /// @param next The Version object to update
    /// @param context The accumulation context
    /// @param result The accumulation result
    /// @param latestExposure The latest exposure
    function _accumulatePositionFeeComponentExposure(
        Version memory next,
        AccumulationContext memory context,
        VersionAccumulationResult memory result,
        Fixed6 latestExposure
    ) private pure {
        Fixed6 impactExposure = context.toOracleVersion.price.sub(context.fromOracleVersion.price).mul(latestExposure);
        Fixed6 impactExposureMaker = impactExposure.mul(Fixed6Lib.NEG_ONE);
        Fixed6 impactExposureProtocol = context.fromPosition.maker.isZero() ? impactExposureMaker : Fixed6Lib.ZERO;
        impactExposureMaker = impactExposureMaker.sub(impactExposureProtocol);
        next.makerValue.increment(impactExposureMaker, context.fromPosition.maker);

        result.positionFeeExposure = impactExposure;
        result.positionFeeExposureProtocol = impactExposureProtocol;
        result.positionFeeExposureMaker = impactExposureMaker;
    }

    /// @notice Globally accumulates all long-short funding since last oracle update
    /// @param next The Version object to update
    /// @param context The accumulation context
    /// @return fundingMaker The total funding accrued by makers
    /// @return fundingLong The total funding accrued by longs
    /// @return fundingShort The total funding accrued by shorts
    /// @return fundingFee The total fee accrued from funding accumulation
    function _accumulateFunding(Version memory next, AccumulationContext memory context) private pure returns (
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
        AccumulationContext memory context
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
        AccumulationContext memory context
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
