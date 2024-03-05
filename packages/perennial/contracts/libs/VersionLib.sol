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

// TODO: natspec pass

/// @dev Individual accumulation values
struct VersionAccumulation {
    VersionLinearAccumulation linearFeeMaker;
    VersionLinearAccumulation linearFeeTaker;
    VersionBiAccumulation proportionalFeeMaker;
    VersionBiAccumulation proportionalFeeTaker;
    Fixed6 adiabaticFeeMakerPos;
    Fixed6 adiabaticFeeMakerNeg;
    Fixed6 adiabaticFeeTakerPos;
    Fixed6 adiabaticFeeTakerNeg;

    VersionTriAccumulation funding;
    VersionTriAccumulation interest;
    VersionTriAccumulation pnl;

    BiAccumulation positionFeeExposure; // TODO
    Fixed6 positionFeeMarketExposure; // TODO

    UFixed6 settlementFee;
    UFixed6 liquidationFee;
}

struct VersionLinearAccumulation {
    BiAccumulation accumulation;
    UFixed6 subtractiveFee;
    UFixed6 fee;
}

struct VersionBiAccumulation {
    BiAccumulation accumulation;
    UFixed6 fee;
}

struct VersionTriAccumulation {
    TriAccumulation accumulation;
    UFixed6 fee;
}

/// @title VersionLib
/// @notice Manages the logic for the global order accumualation
library VersionLib {
    struct Accumulator {
        Accumulator6 makerValue;
        Accumulator6 longValue;
        Accumulator6 shortValue;

        Accumulator6 makerLinearFee;
        Accumulator6 makerProportionalFee;
        Accumulator6 takerLinearFee;
        Accumulator6 takerProportionalFee;

        Accumulator6 makerPosFee;
        Accumulator6 makerNegFee;
        Accumulator6 takerPosFee;
        Accumulator6 takerNegFee;

        Accumulator6 settlementFee;
        Accumulator6 liquidationFee;
    }

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
    /// @return nextVersion The accumulated version
    /// @return nextGlobal The accumulated global
    /// @return accumulation The accumulation result
    function accumulate(
        Version memory self,
        Global memory global,
        Position memory fromPosition,
        Order memory order,
        OracleVersion memory fromOracleVersion,
        OracleVersion memory toOracleVersion,
        MarketParameter memory marketParameter,
        RiskParameter memory riskParameter
    ) external pure returns (Version memory nextVersion, Global memory nextGlobal, VersionAccumulation memory accumulation) {
        Accumulator memory accumulator = Accumulator(
            self.makerValue.with(fromPosition.maker), // TODO: socialized positions?
            self.longValue.with(fromPosition.long),
            self.shortValue.with(fromPosition.short),

            Accumulated6(Fixed6Lib.ZERO).with(order.makerTotal()),
            Accumulated6(Fixed6Lib.ZERO).with(order.makerTotal()),
            Accumulated6(Fixed6Lib.ZERO).with(order.takerTotal()),
            Accumulated6(Fixed6Lib.ZERO).with(order.takerTotal()),

            Accumulated6(Fixed6Lib.ZERO).with(order.makerPos),
            Accumulated6(Fixed6Lib.ZERO).with(order.makerNeg),
            Accumulated6(Fixed6Lib.ZERO).with(order.takerPos()),
            Accumulated6(Fixed6Lib.ZERO).with(order.takerNeg()),

            Accumulated6(Fixed6Lib.ZERO).with(UFixed6Lib.from(order.orders)),
            Accumulated6(Fixed6Lib.ZERO).with(UFixed6Lib.ONE)
        );

        AccumulationContext memory context = AccumulationContext(
            global,
            fromPosition,
            order,
            fromOracleVersion,
            toOracleVersion,
            marketParameter,
            riskParameter
        );

        // record validity
        nextVersion.valid = toOracleVersion.valid;

        // accumulate settlement fee
        _accumulateSettlementFee(accumulator, context, accumulation);

        // accumulate liquidation fee
        _accumulateLiquidationFee(accumulator, context, accumulation);

        // accumulate linear fee
        _accumulateLinearFee(accumulator, context, accumulation);

        // accumulate proportional fee
        _accumulateProportionalFee(accumulator, context, accumulation);

        // accumulate adiabatic fee
        _accumulateAdiabaticFee(accumulator, context, accumulation);

        // accumulate adiabatic fee exposure
        _accumulatePositionFeeComponentExposure(accumulator, context, accumulation);

        // if closed, don't accrue anything else
        if (marketParameter.closed) return (nextVersion, nextGlobal, accumulation);

        // accumulate funding
        _accumulateFunding(accumulator, context, accumulation);

        // accumulate interest
        _accumulateInterest(accumulator, context, accumulation);

        // accumulate P&L
        _accumulatePNL(accumulator, context, accumulation);


        // TODO: populate nextVersion?

        return (nextVersion, global, accumulation);
    }

    /// @notice Globally accumulates settlement fees since last oracle update
    /// @param next The Version object to update
    /// @param context The accumulation context
    function _accumulateSettlementFee(
        Accumulator memory next,
        AccumulationContext memory context,
        VersionAccumulation memory result
    ) private pure {
        result.settlementFee = context.order.orders == 0 ? UFixed6Lib.ZERO : context.marketParameter.settlementFee;
        next.settlementFee.decrement(Fixed6Lib.from(result.settlementFee));
    }

    /// @notice Globally accumulates hypothetical liquidation fee since last oracle update
    /// @param next The Version object to update
    /// @param context The accumulation context
    function _accumulateLiquidationFee(
        Accumulator memory next,
        AccumulationContext memory context,
        VersionAccumulation memory result
    ) private pure {
        result.liquidationFee = context.toOracleVersion.valid ? context.riskParameter.liquidationFee : UFixed6Lib.ZERO;
        next.liquidationFee.decrement(Fixed6Lib.from(result.liquidationFee));
    }

    /// @notice Globally accumulates linear fees since last oracle update
    /// @param next The Version object to update
    /// @param context The accumulation context
    function _accumulateLinearFee(
        Accumulator memory next,
        AccumulationContext memory context,
        VersionAccumulation memory result
    ) private pure {
        if (!context.toOracleVersion.valid) return;

        UFixed6 makerLinearFee = context.riskParameter.makerFee.linear(
            Fixed6Lib.from(context.order.makerTotal()),
            context.toOracleVersion.price.abs()
        );
        (makerLinearFee, result.linearFeeMaker.subtractiveFee) =
            _accumulateSubtractiveFee(makerLinearFee, context.order.makerTotal(), context.order.makerReferral);
        (result.linearFeeMaker.fee, result.linearFeeMaker.accumulation) = Accumulator6Lib.transfer(
            next.makerLinearFee,
            next.makerValue,
            Fixed6Lib.from(makerLinearFee),
            context.marketParameter.positionFee
        );

        UFixed6 takerLinearFee = context.riskParameter.takerFee.linear(
            Fixed6Lib.from(context.order.takerTotal()),
            context.toOracleVersion.price.abs()
        );
        (takerLinearFee, result.linearFeeTaker.subtractiveFee) =
            _accumulateSubtractiveFee(takerLinearFee, context.order.takerTotal(), context.order.takerReferral);
        (result.linearFeeTaker.fee, result.linearFeeTaker.accumulation) = Accumulator6Lib.transfer(
            next.takerLinearFee,
            next.makerValue,
            Fixed6Lib.from(takerLinearFee),
            context.marketParameter.positionFee
        );
    }

    /// @notice Globally accumulates subtractive fees since last oracle update
    /// @param linearFee The linear fee to accumulate
    /// @param total The total order size for the fee
    /// @param referral The referral size for the fee
    /// @return newLinearFee The new linear fee after subtractive fees
    /// @return subtractiveFee The total subtractive fee
    function _accumulateSubtractiveFee(
        UFixed6 linearFee,
        UFixed6 total,
        UFixed6 referral
    ) private pure returns (UFixed6 newLinearFee, UFixed6 subtractiveFee) {
        subtractiveFee = total.isZero() ? UFixed6Lib.ZERO : linearFee.muldiv(referral, total);
        newLinearFee = linearFee.sub(subtractiveFee);
    }

    /// @notice Globally accumulates proportional fees since last oracle update
    /// @param context The accumulation context
    function _accumulateProportionalFee(
        Accumulator memory next,
        AccumulationContext memory context,
        VersionAccumulation memory result
    ) private pure {
        if (!context.toOracleVersion.valid) return;

        UFixed6 makerProportionalFee = context.riskParameter.makerFee.proportional(
            Fixed6Lib.from(context.order.makerTotal()),
            context.toOracleVersion.price.abs()
        );
        (result.proportionalFeeMaker.fee, result.proportionalFeeMaker.accumulation) = Accumulator6Lib.transfer(
            next.makerProportionalFee,
            next.makerValue,
            Fixed6Lib.from(makerProportionalFee),
            context.marketParameter.positionFee
        );

        UFixed6 takerProportionalFee = context.riskParameter.takerFee.proportional(
            Fixed6Lib.from(context.order.takerTotal()),
            context.toOracleVersion.price.abs()
        );
        (result.proportionalFeeTaker.fee, result.proportionalFeeTaker.accumulation) = Accumulator6Lib.transfer(
            next.takerProportionalFee,
            next.makerValue,
            Fixed6Lib.from(takerProportionalFee),
            context.marketParameter.positionFee
        );
    }

    /// @notice Globally accumulates adiabatic fees since last oracle update
    /// @param next The Version object to update
    /// @param context The accumulation context
    function _accumulateAdiabaticFee(
        Accumulator memory next,
        AccumulationContext memory context,
        VersionAccumulation memory result
    ) private pure {
        if (!context.toOracleVersion.valid) return;

        // position fee from positive skew taker orders
        result.adiabaticFeeTakerPos = context.riskParameter.takerFee.adiabatic(
            context.fromPosition.skew(),
            Fixed6Lib.from(context.order.takerPos()),
            context.toOracleVersion.price.abs()
        );
        next.takerPosFee.decrement(result.adiabaticFeeTakerPos);

        // position fee from negative skew taker orders
        result.adiabaticFeeTakerNeg = context.riskParameter.takerFee.adiabatic(
            context.fromPosition.skew().add(Fixed6Lib.from(context.order.takerPos())),
            Fixed6Lib.from(-1, context.order.takerNeg()),
            context.toOracleVersion.price.abs()
        );
        next.takerNegFee.decrement(result.adiabaticFeeTakerNeg);

        // position fee from negative skew maker orders
        result.adiabaticFeeMakerNeg = context.riskParameter.makerFee.adiabatic(
            context.fromPosition.maker,
            Fixed6Lib.from(-1, context.order.makerNeg),
            context.toOracleVersion.price.abs()
        );
        next.makerNegFee.decrement(result.adiabaticFeeMakerNeg);

        // position fee from positive skew maker orders
        result.adiabaticFeeMakerPos = context.riskParameter.makerFee.adiabatic(
            context.fromPosition.maker.sub(context.order.makerNeg),
            Fixed6Lib.from(context.order.makerPos),
            context.toOracleVersion.price.abs()
        );
        next.makerPosFee.decrement(result.adiabaticFeeMakerPos);
    }

    /// @notice Globally accumulates single component of the position fees exposure since last oracle update
    /// @param next The Version object to update
    /// @param context The accumulation context
    function _accumulatePositionFeeComponentExposure(
        Accumulator memory next,
        AccumulationContext memory context,
        VersionAccumulation memory result
    ) private pure {
        Fixed6 latestExposure = context.riskParameter.takerFee.exposure(context.fromPosition.skew())
            .add(context.riskParameter.makerFee.exposure(context.fromPosition.maker));

        result.positionFeeExposure.from = context.toOracleVersion.price.sub(context.fromOracleVersion.price).mul(latestExposure);
        result.positionFeeExposure.to = result.positionFeeExposure.from.mul(Fixed6Lib.NEG_ONE);
        result.positionFeeMarketExposure = context.fromPosition.maker.isZero() ? result.positionFeeExposure.to : Fixed6Lib.ZERO;
        result.positionFeeExposure.to = result.positionFeeExposure.to.sub(result.positionFeeMarketExposure);

        next.makerValue.increment(result.positionFeeExposure.to);
    }

    /// @notice Globally accumulates all long-short funding since last oracle update
    /// @param next The accumulator object to update
    /// @param context The accumulation context
    /// @param result The accumulation result
    function _accumulateFunding(
        Accumulator memory next,
        AccumulationContext memory context,
        VersionAccumulation memory result
    ) private pure {
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

        // Need other data
        (result.funding.fee, result.funding.accumulation) = Accumulator6Lib.transfer(
            next.longValue,
            next.shortValue,
            next.makerValue,
            funding,
            context.marketParameter.fundingFee
        );
    }

    /// @notice Globally accumulates all maker interest since last oracle update
    /// @param next The accumulator object to update
    /// @param context The accumulation context
    /// @param result The accumulation result
    function _accumulateInterest(
        Accumulator memory next,
        AccumulationContext memory context,
        VersionAccumulation memory result
    ) private pure {
        UFixed6 notional = context.fromPosition.long.add(context.fromPosition.short).min(context.fromPosition.maker)
            .mul(context.fromOracleVersion.price.abs());

        // Compute maker interest
        UFixed6 interest = context.riskParameter.utilizationCurve.accumulate(
            context.fromPosition.utilization(context.riskParameter),
            context.fromOracleVersion.timestamp,
            context.toOracleVersion.timestamp,
            notional
        );

        UFixed6 takerRatio = context.fromPosition.long
            .unsafeDiv(context.fromPosition.long.add(context.fromPosition.short));

        // TODO: consolidate
        (UFixed6 longInterstFee, BiAccumulation memory longInterestAccumulation) = Accumulator6Lib.transfer(
            next.longValue,
            next.makerValue,
            Fixed6Lib.from(interest.mul(takerRatio)),
            context.marketParameter.interestFee
        );
        (UFixed6 shortInterstFee, BiAccumulation memory shortInterestAccumulation) = Accumulator6Lib.transfer(
            next.shortValue,
            next.makerValue,
            Fixed6Lib.from(interest.sub(interest.mul(takerRatio))),
            context.marketParameter.interestFee
        );

        result.interest.accumulation = TriAccumulation(
            longInterestAccumulation.from,
            shortInterestAccumulation.from,
            longInterestAccumulation.to.add(shortInterestAccumulation.to)
        );
        result.interest.fee = longInterstFee.add(shortInterstFee);
    }

    /// @notice Globally accumulates position profit & loss since last oracle update
    /// @param next The accumulator object to update
    /// @param context The accumulation context
    /// @param result The accumulation result
    function _accumulatePNL(
        Accumulator memory next,
        AccumulationContext memory context,
        VersionAccumulation memory result
    ) private pure {
        Fixed6 pnl = context.toOracleVersion.price.sub(context.fromOracleVersion.price)
            .mul(Fixed6Lib.from(context.fromPosition.major()));

        (result.pnl.fee, result.pnl.accumulation) = Accumulator6Lib.transfer(
            next.longValue,
            next.shortValue,
            next.makerValue,
            pnl,
            UFixed6Lib.ZERO
        );
    }
}
