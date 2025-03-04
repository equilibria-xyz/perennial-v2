// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { Fixed6, Fixed6Lib } from "@equilibria/root/number/types/Fixed6.sol";
import { IMarket } from "../interfaces/IMarket.sol";
import { MarketParameter } from "../types/MarketParameter.sol";
import { RiskParameter } from "../types/RiskParameter.sol";
import { Global } from "../types/Global.sol";
import { Position } from "../types/Position.sol";
import { Order } from "../types/Order.sol";
import { Guarantee } from "../types/Guarantee.sol";
import { Version } from "../types/Version.sol";
import { OracleVersion } from "../types/OracleVersion.sol";
import { OracleReceipt } from "../types/OracleReceipt.sol";

/// @dev The response of the version accumulation
///      Contains only select fee information needed for the downstream market contract
///      Returned by the accumulate function
struct VersionAccumulationResponse {
    /// @dev The total market fee charged including (tradeFee, tradeOffsetMarket, fundingFee, interestFee)
    UFixed6 marketFee;

    /// @dev The settlement fee charged
    UFixed6 settlementFee;

    /// @dev The market's adiabatic exposure
    Fixed6 marketExposure;
}

/// @dev The result of the version accumulation
///      Contains all the accumulated values for the version
///      Emitted via the PositionProcessed event
struct VersionAccumulationResult {
    /// @dev The trade fee charged
    UFixed6 tradeFee;

    /// @dev The subtractive fee charged
    UFixed6 subtractiveFee;

    /// @dev The total price impact of the trade (including linear, proportional, and adiabatic)
    Fixed6 tradeOffset;

    /// @dev The portion of the trade offset that the makers receive
    Fixed6 tradeOffsetMaker;

    /// @dev The portion of the trade offset that the market receives (if there are no makers)
    UFixed6 tradeOffsetMarket;

    /// @dev The adiabatic exposure accrued
    Fixed6 adiabaticExposure;

    /// @dev The adiabatic exposure accrued by makers
    Fixed6 adiabaticExposureMaker;

    /// @dev The adiabatic exposure accrued by the market
    Fixed6 adiabaticExposureMarket;

    /// @dev Funding accrued by makers
    Fixed6 fundingMaker;

    /// @dev Funding accrued by longs
    Fixed6 fundingLong;

    /// @dev Funding accrued by shorts
    Fixed6 fundingShort;

    /// @dev Funding received by the protocol
    UFixed6 fundingFee;

    /// @dev Interest accrued by makers
    Fixed6 interestMaker;

    /// @dev Interest accrued by longs
    Fixed6 interestLong;

    /// @dev Interest accrued by shorts
    Fixed6 interestShort;

    /// @dev Interest received by the protocol
    UFixed6 interestFee;

    /// @dev Price-based profit/loss accrued by makers
    Fixed6 pnlMaker;

    /// @dev Price-based profit/loss accrued by longs
    Fixed6 pnlLong;

    /// @dev Price-based profit/loss accrued by shorts
    Fixed6 pnlShort;

    /// @dev Total settlement fee charged
    UFixed6 settlementFee;

    /// @dev Snapshot of the riskParameter.liquidationFee at the version (0 if not valid)
    UFixed6 liquidationFee;
}

/// @dev The in-memory context for the version accumulation
struct VersionAccumulationContext {
    Global global;
    Position fromPosition;
    uint256 orderId;
    Order order;
    Guarantee guarantee;
    OracleVersion fromOracleVersion;
    OracleVersion toOracleVersion;
    OracleReceipt toOracleReceipt;
    MarketParameter marketParameter;
    RiskParameter riskParameter;
}

/// @title VersionLib
/// @dev (external-safe): this library is safe to externalize
/// @notice Manages the logic for the global order accumulation
library VersionLib {
    /// @notice Accumulates the global state for the period from `fromVersion` to `toOracleVersion`
    function accumulate(
        IMarket.Context memory context,
        IMarket.SettlementContext memory settlementContext,
        uint256 newOrderId,
        Order memory newOrder,
        Guarantee memory newGuarantee,
        OracleVersion memory oracleVersion,
        OracleReceipt memory oracleReceipt
    ) external returns (Version memory next, Global memory nextGlobal, VersionAccumulationResponse memory response) {
        VersionAccumulationContext memory accumulationContext = VersionAccumulationContext(
            context.global,
            context.latestPositionGlobal,
            newOrderId,
            newOrder,
            newGuarantee,
            settlementContext.orderOracleVersion,
            oracleVersion,
            oracleReceipt,
            context.marketParameter,
            context.riskParameter
        );

        return _accumulate(settlementContext.latestVersion, accumulationContext);
    }

    /// @notice Accumulates the global state for the period from `fromVersion` to `toOracleVersion`
    /// @param self The Version object to update
    /// @param context The accumulation context
    /// @return next The accumulated version
    /// @return nextGlobal The next global state
    /// @return response The accumulation response
    function _accumulate(
        Version memory self,
        VersionAccumulationContext memory context
    ) private returns (Version memory next, Global memory nextGlobal, VersionAccumulationResponse memory response) {
        VersionAccumulationResult memory result;

        // setup next accumulators
        _next(self, next);

        // record oracle version
        (next.valid, next.price) = (context.toOracleVersion.valid, context.toOracleVersion.price);
        context.global.latestPrice = context.toOracleVersion.price;

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
        if (context.marketParameter.closed) return _return(context, result, next);

        // accumulate funding
        (result.fundingMaker, result.fundingLong, result.fundingShort, result.fundingFee) =
            _accumulateFunding(next, context);

        // accumulate interest
        (result.interestMaker, result.interestLong, result.interestShort, result.interestFee) =
            _accumulateInterest(next, context);

        // accumulate P&L
        (result.pnlMaker, result.pnlLong, result.pnlShort) = _accumulatePNL(next, context);

        return _return(context, result, next);
    }

    function _return(
        VersionAccumulationContext memory context,
        VersionAccumulationResult memory result,
        Version memory next
    ) private returns (Version memory, Global memory, VersionAccumulationResponse memory) {
        emit IMarket.PositionProcessed(context.orderId, context.order, result);

        return (next, context.global, _response(result));
    }

    /// @notice Converts the accumulation result into a response
    /// @param result The accumulation result
    /// @return response The accumulation response
    function _response(
        VersionAccumulationResult memory result
    ) private pure returns (VersionAccumulationResponse memory response) {
        response.marketFee = result.tradeFee
            .add(result.tradeOffsetMarket)
            .add(result.fundingFee)
            .add(result.interestFee);
        response.settlementFee = result.settlementFee;
        response.marketExposure = result.adiabaticExposureMarket;
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
        uint256 orders = context.order.orders - context.guarantee.orders;
        settlementFee = orders == 0 ? UFixed6Lib.ZERO : context.toOracleReceipt.settlementFee;
        next.settlementFee.decrement(Fixed6Lib.from(settlementFee), UFixed6Lib.from(orders));
    }

    /// @notice Globally accumulates hypothetical liquidation fee since last oracle update
    /// @param next The Version object to update
    /// @param context The accumulation context
    function _accumulateLiquidationFee(
        Version memory next,
        VersionAccumulationContext memory context
    ) private pure returns (UFixed6 liquidationFee) {
        liquidationFee = context.toOracleVersion.valid ?
            context.toOracleReceipt.settlementFee.mul(context.riskParameter.liquidationFee) :
            UFixed6Lib.ZERO;
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
        UFixed6 makerTotal = context.order.makerTotal();
        UFixed6 makerFee = context.order.makerFee(context.toOracleVersion, context.marketParameter);
        next.makerFee.decrement(Fixed6Lib.from(makerFee), makerTotal);
        UFixed6 makerSubtractiveFee = makerTotal.isZero() ?
            UFixed6Lib.ZERO :
            makerFee.muldiv(context.order.makerReferral, makerTotal);

        UFixed6 takerTotal = context.order.takerTotal().sub(context.guarantee.takerFee);
        UFixed6 takerFee = context.order.takerFee(context.guarantee, context.toOracleVersion, context.marketParameter);
        next.takerFee.decrement(Fixed6Lib.from(takerFee), takerTotal);
        UFixed6 takerSubtractiveFee = takerTotal.isZero() ?
            UFixed6Lib.ZERO :
            takerFee.muldiv(context.order.takerReferral, takerTotal);

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

        UFixed6 takerPosTotal = context.order.takerPos().sub(context.guarantee.takerPos());
        UFixed6 takerPosLinearFee = context.riskParameter.takerFee.linear(
            Fixed6Lib.from(takerPosTotal),
            context.toOracleVersion.price.abs()
        );
        next.takerPosOffset.decrement(Fixed6Lib.from(takerPosLinearFee), takerPosTotal);

        UFixed6 takerNegTotal = context.order.takerNeg().sub(context.guarantee.takerNeg());
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

        UFixed6 takerPos = context.order.takerPos().sub(context.guarantee.takerPos());
        UFixed6 takerPosProportionalFee = context.riskParameter.takerFee.proportional(
            Fixed6Lib.from(takerPos),
            context.toOracleVersion.price.abs()
        );
        next.takerPosOffset.decrement(Fixed6Lib.from(takerPosProportionalFee), takerPos);

        UFixed6 takerNeg = context.order.takerNeg().sub(context.guarantee.takerNeg());
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
        UFixed6 takerPos = context.order.takerPos().sub(context.guarantee.takerPos());
        adiabaticFee = context.riskParameter.takerFee.adiabatic(
            context.fromPosition.skew(),
            Fixed6Lib.from(takerPos),
            context.toOracleVersion.price.abs()
        );
        next.takerPosOffset.decrement(adiabaticFee, takerPos);
        result.tradeOffset = result.tradeOffset.add(adiabaticFee);

        // position fee from negative skew taker orders
        UFixed6 takerNeg = context.order.takerNeg().sub(context.guarantee.takerNeg());
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
