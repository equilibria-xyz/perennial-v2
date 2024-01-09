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
    UFixed6 positionFeeMaker;
    UFixed6 positionFeeFee;

    Fixed6 impactFeeMaker;
    Fixed6 impactFee;
    Fixed6 impactFeeProtocol;

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
        // record validity
        self.valid = toOracleVersion.valid;

        // accumulate settlement fee
        fees.settlementFee = _accumulateSettlementFee(self, order, marketParameter);

        // accumulate position fee
        (values.positionFeeMaker, fees.marketFee) =
            _accumulatePositionFee(self, fromPosition, order, toOracleVersion, marketParameter, riskParameter);

        // accumulate impact fee
        (values.impactFeeMaker, values.impactFee, values.impactFeeProtocol) =
            _accumulateImpactFee(self, fromPosition, order, fromOracleVersion, toOracleVersion, riskParameter);

        // if closed, don't accrue anything else
        if (marketParameter.closed) return (values, fees);

        // accumulate funding
        _FundingValues memory fundingValues = _accumulateFunding(
            self,
            global,
            fromPosition,
            order,
            fromOracleVersion,
            toOracleVersion,
            marketParameter,
            riskParameter
        );
        (values.fundingMaker, values.fundingLong, values.fundingShort, values.fundingFee) = (
            fundingValues.fundingMaker,
            fundingValues.fundingLong,
            fundingValues.fundingShort,
            fundingValues.fundingFee
        );

        // accumulate interest
        (values.interestMaker, values.interestLong, values.interestShort, values.interestFee) =
            _accumulateInterest(self, fromPosition, fromOracleVersion, toOracleVersion, marketParameter, riskParameter);

        // accumulate P&L
        (values.pnlMaker, values.pnlLong, values.pnlShort) =
            _accumulatePNL(self, fromPosition, fromOracleVersion, toOracleVersion);

        fees.marketFee = fees.marketFee.add(values.positionFeeFee);
        return (values, fees);
    }

    function _accumulateSettlementFee(
        Version memory self,
        Order memory order,
        MarketParameter memory marketParameter
    ) private pure returns (UFixed6 settlementFee) {
        settlementFee = order.orders == 0 ? UFixed6Lib.ZERO : marketParameter.settlementFee;
        self.settlementFee.decrement(Fixed6Lib.from(settlementFee), UFixed6Lib.from(order.orders));
    }
    

    /// @notice Globally accumulates position fees since last oracle update
    /// @param self The Version object to update
    /// @param fromPosition The previous latest position
    /// @param order The next order
    /// @param toOracleVersion The next latest oracle version
    /// @param marketParameter The market parameter
    /// @param riskParameter The risk parameter
    /// @return positionFeeMaker The maker's portion of the position fee
    /// @return positionFeeFee The protocol's portion of the position fee
    function _accumulatePositionFee(
        Version memory self,
        Position memory fromPosition,
        Order memory order,
        OracleVersion memory toOracleVersion,
        MarketParameter memory marketParameter,
        RiskParameter memory riskParameter
    ) private pure returns (UFixed6 positionFeeMaker, UFixed6 positionFeeFee) {
        (UFixed6 makerMagnitude, UFixed6 takerMagnitude) =
            (order.makerPos.add(order.makerNeg), order.takerPos.add(order.takerNeg));

        UFixed6 effectiveMakerFee = riskParameter.makerFee
            .add(riskParameter.makerMagnitudeFee.mul(makerMagnitude.unsafeDiv(riskParameter.skewScale)));
        UFixed6 effectiveTakerFee = riskParameter.takerFee
            .add(riskParameter.takerMagnitudeFee.mul(takerMagnitude.unsafeDiv(riskParameter.skewScale)));

        UFixed6 positionFee = makerMagnitude.mul(toOracleVersion.price.abs()).mul(effectiveMakerFee)
            .add(takerMagnitude.mul(toOracleVersion.price.abs()).mul(effectiveTakerFee));

        positionFeeFee = fromPosition.maker.isZero() ? positionFee : marketParameter.positionFee.mul(positionFee);
        positionFeeMaker = positionFee.sub(positionFeeFee);

        self.makerValue.increment(Fixed6Lib.from(positionFeeMaker), fromPosition.maker);
    }

    /// @notice Globally accumulates position fees since last oracle update
    /// @param self The Version object to update
    /// @param fromPosition The previous latest position
    /// @param order The next order
    /// @param fromOracleVersion The latest oracle version
    /// @param toOracleVersion The next latest oracle version
    /// @param riskParameter The risk parameter
    /// @return positionFeeMaker The maker's portion of the position fee
    /// @return positionFeeImpact The impact portion of the position fee
    function _accumulateImpactFee(
        Version memory self,
        Position memory fromPosition,
        Order memory order,
        OracleVersion memory toOracleVersion,
        OracleVersion memory fromOracleVersion,
        RiskParameter memory riskParameter
    ) private pure returns (Fixed6 positionFeeMaker, Fixed6 positionFeeImpact, Fixed6 positionFeeProtocol) {
        Fixed6 makerFee; Fixed6 impactFee; Fixed6 protocolFee;

        // position fee from positive skew taker orders
        ComponentParams memory component = ComponentParams(
            riskParameter.takerImpactFee,
            fromPosition.skew(),
            Fixed6Lib.from(order.takerPos)
        );
        (positionFeeMaker, positionFeeImpact, positionFeeProtocol) = _accumulateImpactFeeComponent(
            self,
            fromPosition,
            fromOracleVersion,
            toOracleVersion,
            riskParameter,
            component
        );
        self.takerPosFee.decrement(positionFeeImpact, order.takerPos);

        // position fee from negative skew taker orders
        component = ComponentParams(
            riskParameter.takerImpactFee,
            fromPosition.skew().add(Fixed6Lib.from(order.takerPos)),
            Fixed6Lib.from(-1, order.takerNeg)
        );
        (makerFee, impactFee, protocolFee) = _accumulateImpactFeeComponent(
            self,
            fromPosition,
            fromOracleVersion,
            toOracleVersion,
            riskParameter,
            component
        );
        (positionFeeMaker, positionFeeImpact, positionFeeProtocol) =
            (positionFeeMaker.add(makerFee), positionFeeImpact.add(impactFee), positionFeeProtocol.add(protocolFee));
        self.takerNegFee.decrement(impactFee, order.takerNeg);

        // position fee from negative skew maker orders
        UFixed6 latestMakerSkew = riskParameter.skewScale.unsafeSub(fromPosition.maker);
        component = ComponentParams(
            riskParameter.makerImpactFee,
            Fixed6Lib.from(latestMakerSkew),
            Fixed6Lib.from(order.makerNeg)
        );
        (makerFee, impactFee, protocolFee) = _accumulateImpactFeeComponent(
            self,
            fromPosition,
            fromOracleVersion,
            toOracleVersion,
            riskParameter,
            component
        );
        (positionFeeMaker, positionFeeImpact, positionFeeProtocol) =
            (positionFeeMaker.add(makerFee), positionFeeImpact.add(impactFee), positionFeeProtocol.add(protocolFee));
        self.makerNegFee.decrement(impactFee, order.makerNeg);

        // position fee from positive skew maker orders
        latestMakerSkew = latestMakerSkew.add(order.makerNeg);
        component = ComponentParams(
            riskParameter.makerImpactFee,
            Fixed6Lib.from(latestMakerSkew),
            Fixed6Lib.from(-1, order.makerPos.min(latestMakerSkew))
        );
        (makerFee, impactFee, protocolFee) = _accumulateImpactFeeComponent(
            self,
            fromPosition,
            fromOracleVersion,
            toOracleVersion,
            riskParameter,
            component
        );
        (positionFeeMaker, positionFeeImpact, positionFeeProtocol) =
            (positionFeeMaker.add(makerFee), positionFeeImpact.add(impactFee), positionFeeProtocol.add(protocolFee));
        self.makerPosFee.decrement(impactFee, order.makerPos);
    }

    struct ComponentParams {
        LinearAdiabatic6 impactConfig;
        Fixed6 latestSkew;
        Fixed6 orderSkew;
    }

    function _accumulateImpactFeeComponent(
        Version memory self,
        Position memory fromPosition,
        OracleVersion memory fromOracleVersion,
        OracleVersion memory toOracleVersion,
        RiskParameter memory riskParameter,
        ComponentParams memory component
    ) private pure returns (Fixed6 makerFee, Fixed6 impactFee, Fixed6 protocolFee) {
        (Fixed6 impact, Fixed6 totalImpact) = component.impactConfig.compute(
            component.latestSkew.unsafeDiv(Fixed6Lib.from(riskParameter.skewScale)),
            component.orderSkew.unsafeDiv(Fixed6Lib.from(riskParameter.skewScale))
        );
        impactFee = impact.mul(toOracleVersion.price);
        makerFee = toOracleVersion.price.sub(fromOracleVersion.price).mul(totalImpact);

        if (fromPosition.maker.isZero()) return (Fixed6Lib.ZERO, impactFee, makerFee);

        self.makerValue.decrement(makerFee, fromPosition.maker);
    }

    /// @dev Internal struct to bypass stack depth limit
    struct _FundingValues {
        Fixed6 fundingMaker;
        Fixed6 fundingLong;
        Fixed6 fundingShort;
        UFixed6 fundingFee;
    }

    /// @notice Globally accumulates all long-short funding since last oracle update
    /// @param self The Version object to update
    /// @param global The global state
    /// @param fromPosition The previous latest position
    /// @param order The next order
    /// @param fromOracleVersion The previous latest oracle version
    /// @param toOracleVersion The next latest oracle version
    /// @param marketParameter The market parameter
    /// @param riskParameter The risk parameter
    /// @return fundingValues The funding values accumulated
    function _accumulateFunding(
        Version memory self,
        Global memory global,
        Position memory fromPosition,
        Order memory order,
        OracleVersion memory fromOracleVersion,
        OracleVersion memory toOracleVersion,
        MarketParameter memory marketParameter,
        RiskParameter memory riskParameter
    ) private pure returns (_FundingValues memory fundingValues) {
        Fixed6 toSkew = fromPosition.skew().add(order.long).sub(order.short);

        // Compute long-short funding rate
        Fixed6 funding = global.pAccumulator.accumulate(
            riskParameter.pController,
            toSkew.unsafeDiv(Fixed6Lib.from(riskParameter.skewScale)).min(Fixed6Lib.ONE).max(Fixed6Lib.NEG_ONE),
            fromOracleVersion.timestamp,
            toOracleVersion.timestamp,
            fromPosition.takerSocialized().mul(fromOracleVersion.price.abs())
        );

        // Handle maker receive-only status
        if (riskParameter.makerReceiveOnly && funding.sign() != fromPosition.skew().sign())
            funding = funding.mul(Fixed6Lib.NEG_ONE);

        // Initialize long and short funding
        (fundingValues.fundingLong, fundingValues.fundingShort) = (Fixed6Lib.NEG_ONE.mul(funding), funding);

        // Compute fee spread
        fundingValues.fundingFee = funding.abs().mul(marketParameter.fundingFee);
        Fixed6 fundingSpread = Fixed6Lib.from(fundingValues.fundingFee).div(Fixed6Lib.from(2));

        // Adjust funding with spread
        (fundingValues.fundingLong, fundingValues.fundingShort) = (
            fundingValues.fundingLong.sub(Fixed6Lib.from(fundingValues.fundingFee)).add(fundingSpread),
            fundingValues.fundingShort.sub(fundingSpread)
        );

        // Redirect net portion of minor's side to maker
        if (fromPosition.long.gt(fromPosition.short)) {
            fundingValues.fundingMaker = fundingValues.fundingShort.mul(Fixed6Lib.from(fromPosition.socializedMakerPortion()));
            fundingValues.fundingShort = fundingValues.fundingShort.sub(fundingValues.fundingMaker);
        }
        if (fromPosition.short.gt(fromPosition.long)) {
            fundingValues.fundingMaker = fundingValues.fundingLong.mul(Fixed6Lib.from(fromPosition.socializedMakerPortion()));
            fundingValues.fundingLong = fundingValues.fundingLong.sub(fundingValues.fundingMaker);
        }

        self.makerValue.increment(fundingValues.fundingMaker, fromPosition.maker);
        self.longValue.increment(fundingValues.fundingLong, fromPosition.long);
        self.shortValue.increment(fundingValues.fundingShort, fromPosition.short);
    }

    /// @notice Globally accumulates all maker interest since last oracle update
    /// @param self The Version object to update
    /// @param position The previous latest position
    /// @param fromOracleVersion The previous latest oracle version
    /// @param toOracleVersion The next latest oracle version
    /// @param marketParameter The market parameter
    /// @param riskParameter The risk parameter
    /// @return interestMaker The total interest accrued by makers
    /// @return interestLong The total interest accrued by longs
    /// @return interestShort The total interest accrued by shorts
    /// @return interestFee The total fee accrued from interest accumulation
    function _accumulateInterest(
        Version memory self,
        Position memory position,
        OracleVersion memory fromOracleVersion,
        OracleVersion memory toOracleVersion,
        MarketParameter memory marketParameter,
        RiskParameter memory riskParameter
    ) private pure returns (Fixed6 interestMaker, Fixed6 interestLong, Fixed6 interestShort, UFixed6 interestFee) {
        UFixed6 notional = position.long.add(position.short).min(position.maker).mul(fromOracleVersion.price.abs());

        // Compute maker interest
        UFixed6 interest = riskParameter.utilizationCurve.accumulate(
            position.utilization(riskParameter),
            fromOracleVersion.timestamp,
            toOracleVersion.timestamp,
            notional
        );

        // Compute fee
        interestFee = interest.mul(marketParameter.interestFee);

        // Adjust long and short funding with spread
        interestLong = Fixed6Lib.from(
            position.major().isZero() ?
            interest :
            interest.muldiv(position.long, position.long.add(position.short))
        );
        interestShort = Fixed6Lib.from(interest).sub(interestLong);
        interestMaker = Fixed6Lib.from(interest.sub(interestFee));

        interestLong = interestLong.mul(Fixed6Lib.NEG_ONE);
        interestShort = interestShort.mul(Fixed6Lib.NEG_ONE);
        self.makerValue.increment(interestMaker, position.maker);
        self.longValue.increment(interestLong, position.long);
        self.shortValue.increment(interestShort, position.short);
    }

    /// @notice Globally accumulates position profit & loss since last oracle update
    /// @param self The Version object to update
    /// @param position The previous latest position
    /// @param fromOracleVersion The previous latest oracle version
    /// @param toOracleVersion The next latest oracle version
    /// @return pnlMaker The total pnl accrued by makers
    /// @return pnlLong The total pnl accrued by longs
    /// @return pnlShort The total pnl accrued by shorts
    function _accumulatePNL(
        Version memory self,
        Position memory position,
        OracleVersion memory fromOracleVersion,
        OracleVersion memory toOracleVersion
    ) private pure returns (Fixed6 pnlMaker, Fixed6 pnlLong, Fixed6 pnlShort) {
        pnlLong = toOracleVersion.price.sub(fromOracleVersion.price)
            .mul(Fixed6Lib.from(position.longSocialized()));
        pnlShort = fromOracleVersion.price.sub(toOracleVersion.price)
            .mul(Fixed6Lib.from(position.shortSocialized()));
        pnlMaker = pnlLong.add(pnlShort).mul(Fixed6Lib.NEG_ONE);

        self.longValue.increment(pnlLong, position.long);
        self.shortValue.increment(pnlShort, position.short);
        self.makerValue.increment(pnlMaker, position.maker);
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
