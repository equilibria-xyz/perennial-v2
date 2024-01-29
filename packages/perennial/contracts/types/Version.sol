// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/accumulator/types/Accumulator6.sol";
import "@equilibria/root/accumulator/types/UAccumulator6.sol";
import "./ProtocolParameter.sol";
import "./MarketParameter.sol";
import "./RiskParameter.sol";
import "./Global.sol";
import "./Position.sol";
import "./Order.sol";

/// @dev Version type
struct Version {
    /// @dev whether this version had a valid oracle price
    bool valid;

    /// @dev The maker accumulator value
    Accumulator6 makerValue;

    /// @dev The long accumulator value
    Accumulator6 longValue;

    /// @dev The short accumulator value
    Accumulator6 shortValue;

    /// @dev The accumulated fee for positive skew maker orders
    Accumulator6 makerPosFee;

    /// @dev The accumulated fee for negative skew maker orders
    Accumulator6 makerNegFee;

    /// @dev The accumulated fee for positive skew taker orders
    Accumulator6 takerPosFee;

    /// @dev The accumulated fee for negative skew taker orders
    Accumulator6 takerNegFee;

    /// @dev The accumulated settlement fee for each individual order
    Accumulator6 settlementFee;
}
using VersionLib for Version global;
struct VersionStorage { uint256 slot0; uint256 slot1; }
using VersionStorageLib for VersionStorage global;

/// @dev Individual accumulation values
struct VersionAccumulationResult {
    UFixed6 positionFee;
    UFixed6 positionFeeMaker;
    UFixed6 positionFeeProtocol;
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
}

struct VersionFeeResult {
    UFixed6 marketFee;
    UFixed6 settlementFee;
    Fixed6 protocolFee;
}

///@title Version
/// @notice Library that manages global versioned accumulator state.
/// @dev Manages the value accumulator which measures the change in position value over time.
library VersionLib {
    struct AccumulationContext {
        Version self;
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
    /// @param fromOracleVersion The previous latest oracle version
    /// @param toOracleVersion The next latest oracle version
    /// @param marketParameter The market parameter
    /// @param riskParameter The risk parameter
    /// @return values The accumulation result
    /// @return fees The fees accumulated
    function accumulate(
        Version memory self,
        Global memory global,
        Position memory fromPosition,
        Order memory order,
        OracleVersion memory fromOracleVersion,
        OracleVersion memory toOracleVersion,
        MarketParameter memory marketParameter,
        RiskParameter memory riskParameter
    ) internal pure returns (VersionAccumulationResult memory values, VersionFeeResult memory fees) {
        AccumulationContext memory context = AccumulationContext(
            self,
            global,
            fromPosition,
            order,
            fromOracleVersion,
            toOracleVersion,
            marketParameter,
            riskParameter
        );

        // reset per-version accumulators
        _next(self);

        // record validity
        self.valid = toOracleVersion.valid;

        // accumulate settlement fee
        values.settlementFee = _accumulateSettlementFee(self, context);

        // accumulate position fee
        _accumulatePositionFee(self, context, values);

        // if closed, don't accrue anything else
        fees.marketFee = values.positionFeeProtocol;
        fees.settlementFee = values.settlementFee;
        fees.protocolFee = values.positionFeeExposureProtocol;
        if (marketParameter.closed) return (values, fees);

        // accumulate funding
        (values.fundingMaker, values.fundingLong, values.fundingShort, values.fundingFee) =
            _accumulateFunding(self, context);

        // accumulate interest
        (values.interestMaker, values.interestLong, values.interestShort, values.interestFee) =
            _accumulateInterest(self, context);

        // accumulate P&L
        (values.pnlMaker, values.pnlLong, values.pnlShort) = _accumulatePNL(self, context);

        fees.marketFee = fees.marketFee.add(values.fundingFee).add(values.interestFee);
        return (values, fees);
    }

    /// @notice Resets the per-version accumulators to prepare for the next version
    /// @param self The Version object to update
    function _next(Version memory self) internal pure {
        self.makerPosFee._value = Fixed6Lib.ZERO;
        self.makerNegFee._value = Fixed6Lib.ZERO;
        self.takerPosFee._value = Fixed6Lib.ZERO;
        self.takerNegFee._value = Fixed6Lib.ZERO;
        self.settlementFee._value = Fixed6Lib.ZERO;
    }

    /// @notice Globally accumulates settlement fees since last oracle update
    /// @param self The Version object to update
    /// @param context The accumulation context
    function _accumulateSettlementFee(
        Version memory self,
        AccumulationContext memory context
    ) private pure returns (UFixed6 settlementFee) {
        settlementFee = context.order.orders == 0 ? UFixed6Lib.ZERO : context.marketParameter.settlementFee;
        self.settlementFee.decrement(Fixed6Lib.from(settlementFee), UFixed6Lib.from(context.order.orders));
    }

    /// @notice Globally accumulates position fees since last oracle update
    /// @param self The Version object to update
    /// @param context The accumulation context
    function _accumulatePositionFee(
        Version memory self,
        AccumulationContext memory context,
        VersionAccumulationResult memory result
    ) private pure {
        if (!context.toOracleVersion.valid) return;

        Fixed6 exposure = context.riskParameter.takerFee.exposure(context.fromPosition.skew())
            .add(context.riskParameter.makerFee.exposure(context.fromPosition.maker));

        _accumulatePositionFeeComponentExposure(self, context, result, exposure);

        // position fee from positive skew taker orders
        _accumulatePositionFeeComponentTaker(
            self,
            context,
            result,
            context.riskParameter.takerFee,
            self.takerPosFee,
            context.fromPosition.skew(),
            Fixed6Lib.from(context.order.takerPos())
        );

        // position fee from negative skew taker orders
        _accumulatePositionFeeComponentTaker(
            self,
            context,
            result,
            context.riskParameter.takerFee,
            self.takerNegFee,
            context.fromPosition.skew().add(Fixed6Lib.from(context.order.takerPos())),
            Fixed6Lib.from(-1, context.order.takerNeg())
        );

        // position fee from negative skew maker orders
        _accumulatePositionFeeComponentMaker(
            self,
            context,
            result,
            context.riskParameter.makerFee,
            self.makerNegFee,
            context.fromPosition.maker,
            Fixed6Lib.from(-1, context.order.makerNeg)
        );

        // position fee from positive skew maker orders
        _accumulatePositionFeeComponentMaker(
            self,
            context,
            result,
            context.riskParameter.makerFee,
            self.makerPosFee,
            context.fromPosition.maker.sub(context.order.makerNeg),
            Fixed6Lib.from(context.order.makerPos)
        );
    }

    /// @notice Globally accumulates single component of the impact fees since last oracle update
    /// @param self The Version object to update
    /// @param context The accumulation context
    /// @param makerFee The maker fee configuration
    /// @param latestSkew The latest skew
    /// @param orderSkew The order skew
    function _accumulatePositionFeeComponentMaker(
        Version memory self,
        AccumulationContext memory context,
        VersionAccumulationResult memory result,
        InverseAdiabatic6 memory makerFee,
        Accumulator6 memory feeAccumulator,
        UFixed6 latestSkew,
        Fixed6 orderSkew
    ) private pure {
        (UFixed6 linearFee, UFixed6 proportionalFee, Fixed6 adiabaticFee) =
            makerFee.fee(latestSkew, orderSkew, context.toOracleVersion.price.abs());

        _accumulatePositionFeeComponentImpact(result, feeAccumulator, orderSkew.abs(), adiabaticFee);
        _accumulatePositionFeeComponentBase(self, context, result, feeAccumulator, orderSkew.abs(), linearFee, proportionalFee);
    }

    /// @notice Globally accumulates single component of the impact fees since last oracle update
    /// @param self The Version object to update
    /// @param context The accumulation context
    /// @param takerFee The taker fee configuration
    /// @param latestSkew The latest skew
    /// @param orderSkew The order skew
    function _accumulatePositionFeeComponentTaker(
        Version memory self,
        AccumulationContext memory context,
        VersionAccumulationResult memory result,
        LinearAdiabatic6 memory takerFee,
        Accumulator6 memory feeAccumulator,
        Fixed6 latestSkew,
        Fixed6 orderSkew
    ) private pure  {
        (UFixed6 linearFee, UFixed6 proportionalFee, Fixed6 adiabaticFee) =
            takerFee.fee(latestSkew, orderSkew, context.toOracleVersion.price.abs());

        _accumulatePositionFeeComponentImpact(result, feeAccumulator, orderSkew.abs(), adiabaticFee);
        _accumulatePositionFeeComponentBase(self, context, result, feeAccumulator, orderSkew.abs(), linearFee, proportionalFee);
    }

    function _accumulatePositionFeeComponentBase(
        Version memory self,
        AccumulationContext memory context,
        VersionAccumulationResult memory result,
        Accumulator6 memory feeAccumulator,
        UFixed6 orderMagnitude,
        UFixed6 linearFee,
        UFixed6 proportionalFee
    ) private pure {
        UFixed6 positionFee = linearFee.add(proportionalFee);
        feeAccumulator.decrement(Fixed6Lib.from(positionFee), orderMagnitude);

        UFixed6 protocolFee = context.fromPosition.maker.isZero() ? positionFee : context.marketParameter.positionFee.mul(positionFee);
        UFixed6 positionFeeMaker = positionFee.sub(protocolFee);
        self.makerValue.increment(Fixed6Lib.from(positionFeeMaker), context.fromPosition.maker);

        result.positionFee = result.positionFee.add(positionFee);
        result.positionFeeMaker = result.positionFeeMaker.add(positionFeeMaker);
        result.positionFeeProtocol = result.positionFeeProtocol.add(protocolFee);
    }

    function _accumulatePositionFeeComponentImpact(
        VersionAccumulationResult memory result,
        Accumulator6 memory feeAccumulator,
        UFixed6 orderMagnitude,
        Fixed6 adiabaticFee
    ) private pure {
        feeAccumulator.decrement(adiabaticFee, orderMagnitude);
        result.positionFeeImpact = result.positionFeeImpact.add(adiabaticFee);
    }

    function _accumulatePositionFeeComponentExposure(
        Version memory self,
        AccumulationContext memory context,
        VersionAccumulationResult memory result,
        Fixed6 latestExposure
    ) private pure {
        Fixed6 impactExposure = context.toOracleVersion.price.sub(context.fromOracleVersion.price).mul(latestExposure);
        Fixed6 impactExposureMaker = impactExposure.mul(Fixed6Lib.NEG_ONE);
        Fixed6 impactExposureProtocol = context.fromPosition.maker.isZero() ? impactExposureMaker : Fixed6Lib.ZERO;
        impactExposureMaker = impactExposureMaker.sub(impactExposureProtocol);
        self.makerValue.increment(impactExposureMaker, context.fromPosition.maker);
        
        result.positionFeeExposure = impactExposure;
        result.positionFeeExposureProtocol = impactExposureProtocol;
        result.positionFeeExposureMaker = impactExposureMaker;
    }

    /// @notice Globally accumulates all long-short funding since last oracle update
    /// @param self The Version object to update
    /// @param context The accumulation context
    /// @return fundingMaker The total funding accrued by makers
    /// @return fundingLong The total funding accrued by longs
    /// @return fundingShort The total funding accrued by shorts
    /// @return fundingFee The total fee accrued from funding accumulation
    function _accumulateFunding(Version memory self, AccumulationContext memory context) private pure returns (
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

        self.makerValue.increment(fundingMaker, context.fromPosition.maker);
        self.longValue.increment(fundingLong, context.fromPosition.long);
        self.shortValue.increment(fundingShort, context.fromPosition.short);
    }

    /// @notice Globally accumulates all maker interest since last oracle update
    /// @param self The Version object to update
    /// @param context The accumulation context
    /// @return interestMaker The total interest accrued by makers
    /// @return interestLong The total interest accrued by longs
    /// @return interestShort The total interest accrued by shorts
    /// @return interestFee The total fee accrued from interest accumulation
    function _accumulateInterest(
        Version memory self,
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
        self.makerValue.increment(interestMaker, context.fromPosition.maker);
        self.longValue.increment(interestLong, context.fromPosition.long);
        self.shortValue.increment(interestShort, context.fromPosition.short);
    }

    /// @notice Globally accumulates position profit & loss since last oracle update
    /// @param self The Version object to update
    /// @param context The accumulation context
    /// @return pnlMaker The total pnl accrued by makers
    /// @return pnlLong The total pnl accrued by longs
    /// @return pnlShort The total pnl accrued by shorts
    function _accumulatePNL(
        Version memory self,
        AccumulationContext memory context
    ) private pure returns (Fixed6 pnlMaker, Fixed6 pnlLong, Fixed6 pnlShort) {
        pnlLong = context.toOracleVersion.price.sub(context.fromOracleVersion.price)
            .mul(Fixed6Lib.from(context.fromPosition.longSocialized()));
        pnlShort = context.fromOracleVersion.price.sub(context.toOracleVersion.price)
            .mul(Fixed6Lib.from(context.fromPosition.shortSocialized()));
        pnlMaker = pnlLong.add(pnlShort).mul(Fixed6Lib.NEG_ONE);

        self.longValue.increment(pnlLong, context.fromPosition.long);
        self.shortValue.increment(pnlShort, context.fromPosition.short);
        self.makerValue.increment(pnlMaker, context.fromPosition.maker);
    }
}

/// @dev Manually encodes and decodes the Version struct into storage.
///
///     struct StoredVersion {
///         /* slot 0 */
///         bool valid;
///         int64 makerValue;
///         int64 longValue;
///         int64 shortValue;
///
///         /* slot 1 */
///         int48 makerPosFee;
///         int48 makerNegFee;
///         int48 takerPosFee;
///         int48 takerNegFee;
///         uint48 settlementFee;
///     }
///
library VersionStorageLib {
    // sig: 0xd2777e72
    error VersionStorageInvalidError();

    function read(VersionStorage storage self) internal view returns (Version memory) {
        (uint256 slot0, uint256 slot1) = (self.slot0, self.slot1);
        return Version(
            (uint256(slot0 << (256 - 8)) >> (256 - 8)) != 0,
            Accumulator6(Fixed6.wrap(int256(slot0 << (256 - 8 - 64)) >> (256 - 64))),
            Accumulator6(Fixed6.wrap(int256(slot0 << (256 - 8 - 64 - 64)) >> (256 - 64))),
            Accumulator6(Fixed6.wrap(int256(slot0 << (256 - 8 - 64 - 64 - 64)) >> (256 - 64))),
            Accumulator6(Fixed6.wrap(int256(slot1 << (256 - 48)) >> (256 - 48))),
            Accumulator6(Fixed6.wrap(int256(slot1 << (256 - 48 - 48)) >> (256 - 48))),
            Accumulator6(Fixed6.wrap(int256(slot1 << (256 - 48 - 48 - 48)) >> (256 - 48))),
            Accumulator6(Fixed6.wrap(int256(slot1 << (256 - 48 - 48 - 48 - 48)) >> (256 - 48))),
            Accumulator6(Fixed6.wrap(int256(slot1 << (256 - 48 - 48 - 48 - 48 - 48)) >> (256 - 48)))
        );
    }

    function store(VersionStorage storage self, Version memory newValue) internal {
        if (newValue.makerValue._value.gt(Fixed6.wrap(type(int64).max))) revert VersionStorageInvalidError();
        if (newValue.makerValue._value.lt(Fixed6.wrap(type(int64).min))) revert VersionStorageInvalidError();
        if (newValue.longValue._value.gt(Fixed6.wrap(type(int64).max))) revert VersionStorageInvalidError();
        if (newValue.longValue._value.lt(Fixed6.wrap(type(int64).min))) revert VersionStorageInvalidError();
        if (newValue.shortValue._value.gt(Fixed6.wrap(type(int64).max))) revert VersionStorageInvalidError();
        if (newValue.shortValue._value.lt(Fixed6.wrap(type(int64).min))) revert VersionStorageInvalidError();
        if (newValue.makerPosFee._value.gt(Fixed6.wrap(type(int48).max))) revert VersionStorageInvalidError();
        if (newValue.makerPosFee._value.lt(Fixed6.wrap(type(int48).min))) revert VersionStorageInvalidError();
        if (newValue.makerNegFee._value.gt(Fixed6.wrap(type(int48).max))) revert VersionStorageInvalidError();
        if (newValue.makerNegFee._value.lt(Fixed6.wrap(type(int48).min))) revert VersionStorageInvalidError();
        if (newValue.takerPosFee._value.gt(Fixed6.wrap(type(int48).max))) revert VersionStorageInvalidError();
        if (newValue.takerPosFee._value.lt(Fixed6.wrap(type(int48).min))) revert VersionStorageInvalidError();
        if (newValue.takerNegFee._value.gt(Fixed6.wrap(type(int48).max))) revert VersionStorageInvalidError();
        if (newValue.takerNegFee._value.lt(Fixed6.wrap(type(int48).min))) revert VersionStorageInvalidError();
        if (newValue.settlementFee._value.gt(Fixed6.wrap(type(int48).max))) revert VersionStorageInvalidError();
        if (newValue.settlementFee._value.lt(Fixed6.wrap(type(int48).min))) revert VersionStorageInvalidError();

        uint256 encoded0 =
            uint256((newValue.valid ? uint256(1) : uint256(0)) << (256 - 8)) >> (256 - 8) |
            uint256(Fixed6.unwrap(newValue.makerValue._value) << (256 - 64)) >> (256 - 8 - 64) |
            uint256(Fixed6.unwrap(newValue.longValue._value) << (256 - 64)) >> (256 - 8 - 64 - 64) |
            uint256(Fixed6.unwrap(newValue.shortValue._value) << (256 - 64)) >> (256 - 8 - 64 - 64 - 64);
        uint256 encoded1 =
            uint256(Fixed6.unwrap(newValue.makerPosFee._value) << (256 - 48)) >> (256 - 48) |
            uint256(Fixed6.unwrap(newValue.makerNegFee._value) << (256 - 48)) >> (256 - 48 - 48) |
            uint256(Fixed6.unwrap(newValue.takerPosFee._value) << (256 - 48)) >> (256 - 48 - 48 - 48) |
            uint256(Fixed6.unwrap(newValue.takerNegFee._value) << (256 - 48)) >> (256 - 48 - 48 - 48 - 48) |
            uint256(Fixed6.unwrap(newValue.settlementFee._value) << (256 - 48)) >> (256 - 48 - 48 - 48 - 48 - 48);

        assembly {
            sstore(self.slot, encoded0)
            sstore(add(self.slot, 1), encoded1)
        }
    }
}
