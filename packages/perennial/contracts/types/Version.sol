// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/accumulator/types/Accumulator6.sol";
import "@equilibria/root/accumulator/types/UAccumulator6.sol";
import "./ProtocolParameter.sol";
import "./MarketParameter.sol";
import "./RiskParameter.sol";
import "./Global.sol";
import "./Position.sol";

/// @dev Version type
struct Version {
    bool valid;
    Accumulator6 makerValue;
    Accumulator6 longValue;
    Accumulator6 shortValue;
    UAccumulator6 makerReward;
    UAccumulator6 longReward;
    UAccumulator6 shortReward;
}
using VersionLib for Version global;
struct StoredVersion {
    bool _valid;
    int88 _makerValue;
    int80 _longValue;
    int80 _shortValue;
    uint88 _makerReward;
    uint80 _longReward;
    uint80 _shortReward;
    bytes1 __unallocated__;
}
struct VersionStorage { StoredVersion value; }
using VersionStorageLib for VersionStorage global;

/// @dev Individual accumulation values
struct VersionAccumulationResult {
    UFixed6 positionFeeMaker;
    UFixed6 positionFeeFee;

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

    UFixed6 rewardMaker;
    UFixed6 rewardLong;
    UFixed6 rewardShort;
}

/**
 * @title VersionLib
 * @notice Library that manages global versioned accumulator state.
 * @dev Manages two accumulators: value and reward. The value accumulator measures the change in position value
 *      over time. The reward accumulator measures the change in liquidity ownership over time (for tracking
 *      incentivization rewards).
 *
 *      Both accumulators are stamped for historical lookup anytime there is a global settlement, which services
 *      the delayed-position accounting. It is not guaranteed that every version will have a value stamped, but
 *      only versions when a settlement occurred are needed for this historical computation.
 */
library VersionLib {
    /**
     * @notice Accumulates the global state for the period from `fromVersion` to `toOracleVersion`
     * @param self The struct to operate on
     * @return values The accumulated values
     * @return totalFee The total fee
     */
    function accumulate(
        Version memory self,
        Global memory global,
        Position memory fromPosition,
        Position memory toPosition,
        OracleVersion memory fromOracleVersion,
        OracleVersion memory toOracleVersion,
        MarketParameter memory marketParameter,
        RiskParameter memory riskParameter
    ) internal pure returns (VersionAccumulationResult memory values, UFixed6 totalFee) {
        if (marketParameter.closed) return (values, UFixed6Lib.ZERO);

        // accumulate position
        (values.positionFeeMaker, values.positionFeeFee) = _accumulatePositionFee(self, fromPosition, toPosition, marketParameter);

        // accumulate funding
        _FundingValues memory fundingValues = _accumulateFunding(self, global, fromPosition, fromOracleVersion, toOracleVersion, marketParameter, riskParameter);
        (values.fundingMaker, values.fundingLong, values.fundingShort, values.fundingFee) = (fundingValues.fundingMaker, fundingValues.fundingLong, fundingValues.fundingShort, fundingValues.fundingFee);

        // accumulate interest
        (values.interestMaker, values.interestLong, values.interestShort, values.interestFee) = _accumulateInterest(self, fromPosition, fromOracleVersion, toOracleVersion, marketParameter, riskParameter);

        // accumulate P&L
        (values.pnlMaker, values.pnlLong, values.pnlShort) = _accumulatePNL(self, fromPosition, fromOracleVersion, toOracleVersion);

        // accumulate reward
        (values.rewardMaker, values.rewardLong, values.rewardShort) = _accumulateReward(self, fromPosition, fromOracleVersion, toOracleVersion, marketParameter);

        return (values, values.positionFeeFee.add(values.fundingFee).add(values.interestFee));
    }

    /**
     * @notice Globally accumulates position fees since last oracle update
     * @dev Position fees are calculated based on the price at `latestOracleVersion` as that is the price used to
     *      calculate the user's fee total. In the event that settlement is occurring over multiple oracle versions
     *      (i.e. from a -> b -> c) it is safe to use the latestOracleVersion because in the a -> b case, a is always
     *      b - 1, and in the b -> c case the `PrePosition` is always empty so this is skipped.
     * @return positionFeeMaker The total position fee accumulated
     * @return positionFeeFee The position fee that is retained by the protocol and product
     */
    function _accumulatePositionFee(
        Version memory self,
        Position memory fromPosition,
        Position memory toPosition,
        MarketParameter memory marketParameter
    ) private pure returns (UFixed6 positionFeeMaker, UFixed6 positionFeeFee) {
        // If there are no makers to distribute the taker's position fee to, give it to the protocol
        if (fromPosition.maker.isZero()) return (UFixed6Lib.ZERO, toPosition.fee);

        positionFeeFee = marketParameter.positionFee.mul(toPosition.fee);
        positionFeeMaker = toPosition.fee.sub(positionFeeFee);

        self.makerValue.increment(Fixed6Lib.from(positionFeeMaker), fromPosition.maker);
    }

    // Internal struct to bypass stack depth limit
    struct _FundingValues {
        Fixed6 fundingMaker;
        Fixed6 fundingLong;
        Fixed6 fundingShort;
        UFixed6 fundingFee;
    }

    /**
     * @notice Globally accumulates all funding since last oracle update
     * @dev If an oracle version is skipped due to no positions, funding will continue to be
     *      pegged to the price of the last snapshotted oracleVersion until a new one is accumulated.
     *      This is an acceptable approximation.
     * @return fundingValues The funding values accumulated
     */
    function _accumulateFunding(
        Version memory self,
        Global memory global,
        Position memory position,
        OracleVersion memory fromOracleVersion,
        OracleVersion memory toOracleVersion,
        MarketParameter memory marketParameter,
        RiskParameter memory riskParameter
    ) private pure returns (_FundingValues memory fundingValues) {
        // Compute long-short funding rate
        Fixed6 funding = global.pAccumulator.accumulate(
            riskParameter.pController,
            position.skew(),
            fromOracleVersion.timestamp,
            toOracleVersion.timestamp,
            position.takerSocialized().mul(fromOracleVersion.price.abs())
        );

        // Handle maker receive-only status
        if (riskParameter.makerReceiveOnly && funding.sign() != position.skew().sign())
            funding = funding.mul(Fixed6Lib.NEG_ONE);

        // Initialize long and short funding
        (fundingValues.fundingLong, fundingValues.fundingShort) = (Fixed6Lib.NEG_ONE.mul(funding), funding);

        // Compute fee spread
        fundingValues.fundingFee = funding.abs().mul(marketParameter.fundingFee);
        Fixed6 fundingSpread = Fixed6Lib.from(fundingValues.fundingFee).div(Fixed6Lib.from(2));

        // Adjust funding with spread
        (fundingValues.fundingLong, fundingValues.fundingShort) =
            (fundingValues.fundingLong.sub(Fixed6Lib.from(fundingValues.fundingFee)).add(fundingSpread), fundingValues.fundingShort.sub(fundingSpread));

        // Redirect net portion of minor's side to maker
        if (position.long.gt(position.short)) {
            fundingValues.fundingMaker = fundingValues.fundingShort.mul(Fixed6Lib.from(position.skew().abs()));
            fundingValues.fundingShort = fundingValues.fundingShort.sub(fundingValues.fundingMaker);
        }
        if (position.short.gt(position.long)) {
            fundingValues.fundingMaker = fundingValues.fundingLong.mul(Fixed6Lib.from(position.skew().abs()));
            fundingValues.fundingLong = fundingValues.fundingLong.sub(fundingValues.fundingMaker);
        }

        self.makerValue.increment(fundingValues.fundingMaker, position.maker);
        self.longValue.increment(fundingValues.fundingLong, position.long);
        self.shortValue.increment(fundingValues.fundingShort, position.short);
    }

    /**
     * @notice Globally accumulates all interest since last oracle update
     * @dev If an oracle version is skipped due to no positions, funding will continue to be
     *      pegged to the price of the last snapshotted oracleVersion until a new one is accumulated.
     *      This is an acceptable approximation.
     * @return interestMaker The total interest accrued by makers
     * @return interestLong The total interest accrued by longs
     * @return interestShort The total interest accrued by shorts
     * @return interestFee The total fee accrued from interest accumulation
     */
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
            position.utilization(),
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

    /**
     * @notice Globally accumulates position P&L since last oracle update
     */
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

    /**
     * @notice Globally accumulates position's reward since last oracle update
     * @dev This is used to compute incentivization rewards based on market participation
     */
    function _accumulateReward(
        Version memory self,
        Position memory position,
        OracleVersion memory fromOracleVersion,
        OracleVersion memory toOracleVersion,
        MarketParameter memory marketParameter
    ) private pure returns (UFixed6 rewardMaker, UFixed6 rewardLong, UFixed6 rewardShort){
        UFixed6 elapsed = UFixed6Lib.from(toOracleVersion.timestamp - fromOracleVersion.timestamp);
        rewardMaker = elapsed.mul(marketParameter.makerRewardRate);
        rewardLong = elapsed.mul(marketParameter.longRewardRate);
        rewardShort = elapsed.mul(marketParameter.shortRewardRate);

        if (!position.maker.isZero())
            self.makerReward.increment(rewardMaker, position.maker);
        if (!position.long.isZero())
            self.longReward.increment(rewardLong, position.long);
        if (!position.short.isZero())
            self.shortReward.increment(rewardShort, position.short);
    }
}

library VersionStorageLib {
    error VersionStorageInvalidError();

    function read(VersionStorage storage self) internal view returns (Version memory) {
        StoredVersion memory storedValue = self.value;
        return Version(
            storedValue._valid,
            Accumulator6(Fixed6.wrap(int256(storedValue._makerValue))),
            Accumulator6(Fixed6.wrap(int256(storedValue._longValue))),
            Accumulator6(Fixed6.wrap(int256(storedValue._shortValue))),
            UAccumulator6(UFixed6.wrap(uint256(storedValue._makerReward))),
            UAccumulator6(UFixed6.wrap(uint256(storedValue._longReward))),
            UAccumulator6(UFixed6.wrap(uint256(storedValue._shortReward)))
        );
    }

    function store(VersionStorage storage self, Version memory newValue) internal {
        if (newValue.makerValue._value.gt(Fixed6.wrap(type(int88).max))) revert VersionStorageInvalidError();
        if (newValue.makerValue._value.lt(Fixed6.wrap(type(int88).min))) revert VersionStorageInvalidError();
        if (newValue.longValue._value.gt(Fixed6.wrap(type(int80).max))) revert VersionStorageInvalidError();
        if (newValue.longValue._value.lt(Fixed6.wrap(type(int80).min))) revert VersionStorageInvalidError();
        if (newValue.shortValue._value.gt(Fixed6.wrap(type(int80).max))) revert VersionStorageInvalidError();
        if (newValue.shortValue._value.lt(Fixed6.wrap(type(int80).min))) revert VersionStorageInvalidError();
        if (newValue.makerReward._value.gt(UFixed6.wrap(type(uint88).max))) revert VersionStorageInvalidError();
        if (newValue.longReward._value.gt(UFixed6.wrap(type(uint80).max))) revert VersionStorageInvalidError();
        if (newValue.shortReward._value.gt(UFixed6.wrap(type(uint80).max))) revert VersionStorageInvalidError();

        self.value = StoredVersion(
            true, // only valid versions get stored
            int88(Fixed6.unwrap(newValue.makerValue._value)),
            int80(Fixed6.unwrap(newValue.longValue._value)),
            int80(Fixed6.unwrap(newValue.shortValue._value)),
            uint88(UFixed6.unwrap(newValue.makerReward._value)),
            uint80(UFixed6.unwrap(newValue.longReward._value)),
            uint80(UFixed6.unwrap(newValue.shortReward._value)),
            bytes1(0)
        );
    }
}
