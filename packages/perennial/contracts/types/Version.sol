// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/accumulator/types/Accumulator6.sol";
import "@equilibria/root/accumulator/types/AccumulatorValue6.sol";
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
    AccumulatorValue6 makerValue;

    /// @dev The long accumulator value
    AccumulatorValue6 longValue;

    /// @dev The short accumulator value
    AccumulatorValue6 shortValue;

    /// @dev The accumulated fee for positive skew maker orders
    AccumulatorValue6 makerPosFee;

    /// @dev The accumulated fee for negative skew maker orders
    AccumulatorValue6 makerNegFee;

    /// @dev The accumulated fee for positive skew taker orders
    AccumulatorValue6 takerPosFee;

    /// @dev The accumulated fee for negative skew taker orders
    AccumulatorValue6 takerNegFee;

    /// @dev The accumulated settlement fee for each individual order
    AccumulatorValue6 settlementFee;
}
using VersionLib for Version global;
struct VersionStorage { uint256 slot0; uint256 slot1; }
using VersionStorageLib for VersionStorage global;

/// @dev Individual accumulation values
struct VersionAccumulation {
    VersionOrderAccumulation positionFeeMakerPos;
    VersionOrderAccumulation positionFeeMakerNeg;
    VersionOrderAccumulation positionFeeTakerPos;
    VersionOrderAccumulation positionFeeTakerNeg;

    VersionPositionAccumulation funding;
    VersionPositionAccumulation interest;
    VersionPositionAccumulation pnl;

    BiAccumulation positionFeeExposure;
    Fixed6 positionFeeMarketExposure;
    UFixed6 settlementFee;
}

struct VersionOrderAccumulation {
    BiAccumulation accumulation;
    UFixed6 fee;
    Fixed6 adiabatic;
}

struct VersionPositionAccumulation {
    TriAccumulation accumulation;
    UFixed6 fee;
}

struct VersionFeeResult {
    UFixed6 marketFee;
    UFixed6 settlementFee;
    Fixed6 marketExposure;
}

///@title Version
/// @notice Library that manages global versioned accumulator state.
/// @dev Manages the value accumulator which measures the change in position value over time.
library VersionLib {
    struct AccumulationContext {
        Accumulator6 makerValue;
        Accumulator6 longValue;
        Accumulator6 shortValue;
        Accumulator6 makerPosFee;
        Accumulator6 makerNegFee;
        Accumulator6 takerPosFee;
        Accumulator6 takerNegFee;
        Accumulator6 settlementFee;

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
    /// @return result The accumulation result
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
    ) internal pure returns (VersionAccumulation memory result, VersionFeeResult memory fees) {
        AccumulationContext memory context = AccumulationContext(
            Accumulator6(self.makerValue, fromPosition.maker), // TODO: socialized positions?
            Accumulator6(self.longValue, fromPosition.long),
            Accumulator6(self.shortValue, fromPosition.short),
            Accumulator6(AccumulatorValue6(Fixed6Lib.ZERO), order.makerPos),
            Accumulator6(AccumulatorValue6(Fixed6Lib.ZERO), order.makerNeg),
            Accumulator6(AccumulatorValue6(Fixed6Lib.ZERO), order.takerPos()),
            Accumulator6(AccumulatorValue6(Fixed6Lib.ZERO), order.takerNeg()),
            Accumulator6(AccumulatorValue6(Fixed6Lib.ZERO), UFixed6Lib.from(order.orders)),
            global,
            fromPosition,
            order,
            fromOracleVersion,
            toOracleVersion,
            marketParameter,
            riskParameter
        );

        // record validity
        self.valid = toOracleVersion.valid;

        // accumulate settlement fee
        result.settlementFee = _accumulateSettlementFee(context);
        fees.settlementFee = result.settlementFee;

        if (!context.toOracleVersion.valid) return (result, fees);

        // accumulate position fee adiabatic pool exposure
        (result.positionFeeMarketExposure, result.positionFeeExposure) = _accumulatePositionFeeExposure(context);
        fees.marketExposure = result.positionFeeMarketExposure;

        // accumulate position fee
        result.positionFeeTakerPos = _accumulatePositionFeeTakerPos(context);
        result.positionFeeTakerNeg = _accumulatePositionFeeTakerNeg(context);
        result.positionFeeMakerNeg = _accumulatePositionFeeMakerNeg(context);
        result.positionFeeMakerPos = _accumulatePositionFeeMakerPos(context);
        fees.marketFee = result.positionFeeTakerPos.fee
            .add(result.positionFeeTakerNeg.fee)
            .add(result.positionFeeMakerNeg.fee)
            .add(result.positionFeeMakerPos.fee);

        // if closed, don't accrue anything else
        if (marketParameter.closed) return (result, fees);

        // accumulate funding
        result.funding = _accumulateFunding(context);
        fees.marketFee = fees.marketFee.add(result.funding.fee);

        // accumulate interest
        result.interest = _accumulateInterest(context);
        fees.marketFee = fees.marketFee.add(result.interest.fee);

        // accumulate P&L
        result.pnl = _accumulatePNL(context);

        // update self
        _update(self, context);
    }

    function _update(Version memory self, AccumulationContext memory context) internal pure {
        (self.makerValue, self.longValue, self.shortValue) = (
            context.makerValue._value,
            context.longValue._value,
            context.shortValue._value
        );
        (self.makerPosFee, self.makerNegFee, self.takerPosFee, self.takerNegFee, self.settlementFee) = (
            context.makerPosFee._value,
            context.makerNegFee._value,
            context.takerPosFee._value,
            context.takerNegFee._value,
            context.settlementFee._value
        );
    }

    /// @notice Globally accumulates settlement fees since last oracle update
    /// @param context The accumulation context
    function _accumulateSettlementFee(AccumulationContext memory context) private pure returns (UFixed6 settlementFee) {
        settlementFee = context.order.orders == 0 ? UFixed6Lib.ZERO : context.marketParameter.settlementFee;
        context.settlementFee.decrement(Fixed6Lib.from(settlementFee));
    }

    function _accumulatePositionFeeTakerPos(
        AccumulationContext memory context
    ) private pure returns (VersionOrderAccumulation memory) {
        return _accumulatePositionFeeComponentTaker(
            context,
            context.takerPosFee,
            context.fromPosition.skew(),
            Fixed6Lib.from(context.order.takerPos())
        );
    }

    function _accumulatePositionFeeTakerNeg(
        AccumulationContext memory context
    ) private pure returns (VersionOrderAccumulation memory) {
        return _accumulatePositionFeeComponentTaker(
            context,
            context.takerNegFee,
            context.fromPosition.skew().add(Fixed6Lib.from(context.order.takerPos())),
            Fixed6Lib.from(-1, context.order.takerNeg())
        );
    }

    function _accumulatePositionFeeMakerNeg(
        AccumulationContext memory context
    ) private pure returns (VersionOrderAccumulation memory) {
        return _accumulatePositionFeeComponentMaker(
            context,
            context.makerNegFee,
            context.fromPosition.maker,
            Fixed6Lib.from(-1, context.order.makerNeg)
        );
    }

    function _accumulatePositionFeeMakerPos(
        AccumulationContext memory context
    ) private pure returns (VersionOrderAccumulation memory) {
        return _accumulatePositionFeeComponentMaker(
            context,
            context.makerPosFee,
            context.fromPosition.maker.sub(context.order.makerNeg),
            Fixed6Lib.from(context.order.makerPos)
        );
    }

    /// @notice Globally accumulates single component of the impact fees since last oracle update
    /// @param context The accumulation context
    /// @param feeAccumulator The accumulator to update
    /// @param latestSkew The latest skew
    /// @param orderSkew The order skew
    function _accumulatePositionFeeComponentMaker(
        AccumulationContext memory context,
        Accumulator6 memory feeAccumulator,
        UFixed6 latestSkew,
        Fixed6 orderSkew
    ) private pure returns (VersionOrderAccumulation memory accumulation) {
        (, UFixed6 linearFee, UFixed6 proportionalFee, Fixed6 adiabaticFee) =
            context.riskParameter.makerFee.sync(latestSkew, orderSkew, context.toOracleVersion.price.abs());

        accumulation.adiabatic = adiabaticFee;
        feeAccumulator.decrement(adiabaticFee);
        (accumulation.fee, accumulation.accumulation) = Accumulator6Lib.transfer(
            feeAccumulator,
            context.makerValue,
            Fixed6Lib.from(linearFee.add(proportionalFee)),
            context.marketParameter.positionFee
        );
    }

    /// @notice Globally accumulates single component of the impact fees since last oracle update
    /// @param context The accumulation context
    /// @param feeAccumulator The accumulator to update
    /// @param latestSkew The latest skew
    /// @param orderSkew The order skew
    function _accumulatePositionFeeComponentTaker(
        AccumulationContext memory context,
        Accumulator6 memory feeAccumulator,
        Fixed6 latestSkew,
        Fixed6 orderSkew
    ) private pure returns (VersionOrderAccumulation memory accumulation) {
        (, UFixed6 linearFee, UFixed6 proportionalFee, Fixed6 adiabaticFee) =
            context.riskParameter.takerFee.sync(latestSkew, orderSkew, context.toOracleVersion.price.abs());

        accumulation.adiabatic = adiabaticFee;
        feeAccumulator.decrement(adiabaticFee);
        (accumulation.fee, accumulation.accumulation) = Accumulator6Lib.transfer(
            feeAccumulator,
            context.makerValue,
            Fixed6Lib.from(linearFee.add(proportionalFee)),
            context.marketParameter.positionFee
        );
    }

    function _accumulatePositionFeeExposure(
        AccumulationContext memory context
    ) private pure returns (Fixed6 marketExposure, BiAccumulation memory accumulation) {
        (Fixed6 latestTakerExposure, , , ) =
            context.riskParameter.takerFee.sync(context.fromPosition.skew(), Fixed6Lib.ZERO, context.toOracleVersion.price.abs());
        (Fixed6 latestMakerExposure, , , ) =
            context.riskParameter.makerFee.sync(context.fromPosition.maker, Fixed6Lib.ZERO, context.toOracleVersion.price.abs());

        Fixed6 latestExposure = latestTakerExposure.add(latestMakerExposure);
        accumulation.from = context.toOracleVersion.price.sub(context.fromOracleVersion.price).mul(latestExposure);

        accumulation.to = accumulation.from.mul(Fixed6Lib.NEG_ONE);
        marketExposure = context.fromPosition.maker.isZero() ? accumulation.to : Fixed6Lib.ZERO;
        accumulation.to = accumulation.to.sub(marketExposure);

        context.makerValue.increment(accumulation.to);
    }

    /// @notice Globally accumulates all long-short funding since last oracle update
    /// @param context The accumulation context
    function _accumulateFunding(
        AccumulationContext memory context
    ) private pure returns (VersionPositionAccumulation memory accumulation) {
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
        (accumulation.fee, accumulation.accumulation) = Accumulator6Lib.transfer(
            context.longValue,
            context.shortValue,
            context.makerValue,
            funding,
            context.marketParameter.fundingFee
        );
    }

    /// @notice Globally accumulates all maker interest since last oracle update
    /// @param context The accumulation context
    function _accumulateInterest(
        AccumulationContext memory context
    ) private pure returns (VersionPositionAccumulation memory accumulation) {
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
            context.longValue,
            context.makerValue,
            Fixed6Lib.from(interest.mul(takerRatio)),
            context.marketParameter.interestFee
        );
        (UFixed6 shortInterstFee, BiAccumulation memory shortInterestAccumulation) = Accumulator6Lib.transfer(
            context.shortValue,
            context.makerValue,
            Fixed6Lib.from(interest.sub(interest.mul(takerRatio))),
            context.marketParameter.interestFee
        );
        return VersionPositionAccumulation(
            TriAccumulation(
                longInterestAccumulation.from,
                shortInterestAccumulation.from,
                longInterestAccumulation.to.add(shortInterestAccumulation.to)
            ),
            longInterstFee.add(shortInterstFee)
        );
    }

    /// @notice Globally accumulates position profit & loss since last oracle update
    /// @param context The accumulation context
    function _accumulatePNL(
        AccumulationContext memory context
    ) private pure returns (VersionPositionAccumulation memory accumulation) {
        Fixed6 pnl = context.toOracleVersion.price.sub(context.fromOracleVersion.price)
            .mul(Fixed6Lib.from(context.fromPosition.major()));

        (accumulation.fee, accumulation.accumulation) = Accumulator6Lib.transfer(
            context.longValue,
            context.shortValue,
            context.makerValue,
            pnl,
            UFixed6Lib.ZERO
        );
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
            AccumulatorValue6(Fixed6.wrap(int256(slot0 << (256 - 8 - 64)) >> (256 - 64))),
            AccumulatorValue6(Fixed6.wrap(int256(slot0 << (256 - 8 - 64 - 64)) >> (256 - 64))),
            AccumulatorValue6(Fixed6.wrap(int256(slot0 << (256 - 8 - 64 - 64 - 64)) >> (256 - 64))),
            AccumulatorValue6(Fixed6.wrap(int256(slot1 << (256 - 48)) >> (256 - 48))),
            AccumulatorValue6(Fixed6.wrap(int256(slot1 << (256 - 48 - 48)) >> (256 - 48))),
            AccumulatorValue6(Fixed6.wrap(int256(slot1 << (256 - 48 - 48 - 48)) >> (256 - 48))),
            AccumulatorValue6(Fixed6.wrap(int256(slot1 << (256 - 48 - 48 - 48 - 48)) >> (256 - 48))),
            AccumulatorValue6(Fixed6.wrap(int256(slot1 << (256 - 48 - 48 - 48 - 48 - 48)) >> (256 - 48)))
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
