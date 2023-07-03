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
    Accumulator6 makerValue;
    Accumulator6 longValue;
    Accumulator6 shortValue;
    UAccumulator6 makerReward;
    UAccumulator6 longReward;
    UAccumulator6 shortReward;
    bool valid;
}
using VersionLib for Version global;
struct StoredVersion { // TODO (gas hint): w/ careful overflow enablement we can collapse this to a single slot
    int80 _makerValue;
    int88 _longValue;
    int88 _shortValue;
    uint80 _makerReward;
    uint80 _longReward;
    uint80 _shortReward;
    bool _valid;
    bytes1 __unallocated__;
}
struct VersionStorage { StoredVersion value; }
using VersionStorageLib for VersionStorage global;

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
    ) internal pure returns (UFixed6 fee) {
        if (marketParameter.closed) return UFixed6Lib.ZERO;

        // accumulate position
        UFixed6 positionFee = _accumulatePositionFee(self, fromPosition, toPosition, marketParameter);

        // accumulate funding
        UFixed6 fundingFee = _accumulateFunding(self, global, fromPosition, fromOracleVersion, toOracleVersion, marketParameter, riskParameter);

        // accumulate interest
        UFixed6 interestFee = _accumulateInterest(self, fromPosition, fromOracleVersion, toOracleVersion, marketParameter, riskParameter);

        // accumulate P&L
        _accumulatePNL(self, fromPosition, fromOracleVersion, toOracleVersion);

        // accumulate reward
        _accumulateReward(self, fromPosition, fromOracleVersion, toOracleVersion, riskParameter);

        return positionFee.add(fundingFee).add(interestFee);
    }

    /**
     * @notice Globally accumulates position fees since last oracle update
     * @dev Position fees are calculated based on the price at `latestOracleVersion` as that is the price used to
     *      calculate the user's fee total. In the event that settlement is occurring over multiple oracle versions
     *      (i.e. from a -> b -> c) it is safe to use the latestOracleVersion because in the a -> b case, a is always
     *      b - 1, and in the b -> c case the `PrePosition` is always empty so this is skipped.
     * @return positionFee The position fee that is retained by the protocol and product
     */
    function _accumulatePositionFee(
        Version memory self,
        Position memory fromPosition,
        Position memory toPosition,
        MarketParameter memory marketParameter
    ) private pure returns (UFixed6 positionFee) {
        // If there are no makers to distribute the taker's position fee to, give it to the protocol
        if (fromPosition.maker.isZero()) return toPosition.fee;

        positionFee = marketParameter.positionFee.mul(toPosition.fee);
        UFixed6 makerFee = toPosition.fee.sub(positionFee);
        self.makerValue.increment(Fixed6Lib.from(makerFee), fromPosition.maker);
    }

    /**
     * @notice Globally accumulates all funding since last oracle update
     * @dev If an oracle version is skipped due to no positions, funding will continue to be
     *      pegged to the price of the last snapshotted oracleVersion until a new one is accumulated.
     *      This is an acceptable approximation.
     * @return fundingFee The total fee accrued from funding accumulation
     */
    function _accumulateFunding(
        Version memory self,
        Global memory global,
        Position memory position,
        OracleVersion memory fromOracleVersion,
        OracleVersion memory toOracleVersion,
        MarketParameter memory marketParameter,
        RiskParameter memory riskParameter
    ) private pure returns (UFixed6 fundingFee) {
        if (position.major().isZero()) return UFixed6Lib.ZERO;

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

        // Compute fee spread
        fundingFee = funding.abs().mul(marketParameter.fundingFee);
        Fixed6 fundingSpread = Fixed6Lib.from(fundingFee.div(UFixed6Lib.from(2)));

        // Adjust long and short funding with spread
        (Fixed6 fundingLong, Fixed6 fundingShort, Fixed6 fundingMaker) =
            (Fixed6Lib.NEG_ONE.mul(funding).sub(fundingSpread), funding.sub(fundingSpread), Fixed6Lib.ZERO);

        // Redirect net portion of minor's side to maker
        if (position.long.gt(position.short))
            (fundingMaker, fundingShort) =
                (fundingShort.mul(Fixed6Lib.from(position.skew().abs())), fundingShort.sub(fundingMaker));
        if (position.short.gt(position.long))
            (fundingMaker, fundingLong) =
                (fundingLong.mul(Fixed6Lib.from(position.skew().abs())), fundingLong.sub(fundingMaker));

        // Compute accumulated values
        if (!position.maker.isZero()) self.makerValue.increment(fundingMaker, position.maker);
        if (!position.long.isZero()) self.longValue.increment(fundingLong, position.long);
        if (!position.short.isZero()) self.shortValue.increment(fundingShort, position.short);
    }

    /**
     * @notice Globally accumulates all interest since last oracle update
     * @dev If an oracle version is skipped due to no positions, funding will continue to be
     *      pegged to the price of the last snapshotted oracleVersion until a new one is accumulated.
     *      This is an acceptable approximation.
     * @return interestFee The total fee accrued from interest accumulation
     */
    function _accumulateInterest(
        Version memory self,
        Position memory position,
        OracleVersion memory fromOracleVersion,
        OracleVersion memory toOracleVersion,
        MarketParameter memory marketParameter,
        RiskParameter memory riskParameter
    ) private pure returns (UFixed6 interestFee) {
        if (position.major().isZero()) return UFixed6Lib.ZERO;

        UFixed6 v = position.long.add(position.short).min(position.maker).mul(fromOracleVersion.price.abs());

        // Compute maker interest
        UFixed6 interest = riskParameter.utilizationCurve.accumulate(
            position.utilization(),
            fromOracleVersion.timestamp,
            toOracleVersion.timestamp,
            v
        );

        // Compute fee
        interestFee = interest.mul(marketParameter.interestFee);

        // Adjust long and short funding with spread
        Fixed6 interestLong = Fixed6Lib.from(interest.mul(position.long.div(position.long.add(position.short))));
        Fixed6 interestShort = Fixed6Lib.from(interest).sub(interestLong);
        Fixed6 interestMaker = Fixed6Lib.from(interest.sub(interestFee));

        // Compute accumulated values
        if (!position.maker.isZero()) self.makerValue.increment(interestMaker, position.maker);
        if (!position.long.isZero()) self.longValue.decrement(interestLong, position.long);
        if (!position.short.isZero()) self.shortValue.decrement(interestShort, position.short);
    }

    /**
     * @notice Globally accumulates position P&L since last oracle update
     */
    function _accumulatePNL(
        Version memory self,
        Position memory position,
        OracleVersion memory fromOracleVersion,
        OracleVersion memory toOracleVersion
    ) private pure {
        if (position.major().isZero() || position.maker.isZero()) return;

        Fixed6 totalLongDelta = toOracleVersion.price.sub(fromOracleVersion.price)
            .mul(Fixed6Lib.from(position.longSocialized()));
        Fixed6 totalShortDelta = fromOracleVersion.price.sub(toOracleVersion.price)
            .mul(Fixed6Lib.from(position.shortSocialized()));
        Fixed6 totalMakerDelta = totalLongDelta.add(totalShortDelta);

        if (!position.long.isZero()) self.longValue.increment(totalLongDelta, position.long);
        if (!position.short.isZero()) self.shortValue.increment(totalShortDelta, position.short);
        if (!position.maker.isZero()) self.makerValue.decrement(totalMakerDelta, position.maker);
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
        RiskParameter memory riskParameter
    ) private pure {
        UFixed6 elapsed = UFixed6Lib.from(toOracleVersion.timestamp - fromOracleVersion.timestamp);

        if (!position.maker.isZero())
            self.makerReward.increment(elapsed.mul(riskParameter.makerRewardRate), position.maker);
        if (!position.long.isZero())
            self.longReward.increment(elapsed.mul(riskParameter.longRewardRate), position.long);
        if (!position.short.isZero())
            self.shortReward.increment(elapsed.mul(riskParameter.shortRewardRate), position.short);
    }
}

library VersionStorageLib {
    error VersionStorageInvalidError();

    function read(VersionStorage storage self) internal view returns (Version memory) {
        StoredVersion memory storedValue = self.value;
        return Version(
            Accumulator6(Fixed6.wrap(int256(storedValue._makerValue))),
            Accumulator6(Fixed6.wrap(int256(storedValue._longValue))),
            Accumulator6(Fixed6.wrap(int256(storedValue._shortValue))),
            UAccumulator6(UFixed6.wrap(uint256(storedValue._makerReward))),
            UAccumulator6(UFixed6.wrap(uint256(storedValue._longReward))),
            UAccumulator6(UFixed6.wrap(uint256(storedValue._shortReward))),
            storedValue._valid
        );
    }

    function store(VersionStorage storage self, Version memory newValue) internal {
        if (newValue.makerValue._value.gt(Fixed6.wrap(type(int80).max))) revert VersionStorageInvalidError();
        if (newValue.makerValue._value.lt(Fixed6.wrap(type(int80).min))) revert VersionStorageInvalidError();
        if (newValue.longValue._value.gt(Fixed6.wrap(type(int88).max))) revert VersionStorageInvalidError();
        if (newValue.longValue._value.lt(Fixed6.wrap(type(int88).min))) revert VersionStorageInvalidError();
        if (newValue.shortValue._value.gt(Fixed6.wrap(type(int88).max))) revert VersionStorageInvalidError();
        if (newValue.shortValue._value.lt(Fixed6.wrap(type(int88).min))) revert VersionStorageInvalidError();
        if (newValue.makerReward._value.gt(UFixed6.wrap(type(uint80).max))) revert VersionStorageInvalidError();
        if (newValue.longReward._value.gt(UFixed6.wrap(type(uint88).max))) revert VersionStorageInvalidError();
        if (newValue.shortReward._value.gt(UFixed6.wrap(type(uint88).max))) revert VersionStorageInvalidError();

        self.value = StoredVersion(
            int80(Fixed6.unwrap(newValue.makerValue._value)),
            int88(Fixed6.unwrap(newValue.longValue._value)),
            int88(Fixed6.unwrap(newValue.shortValue._value)),
            uint80(UFixed6.unwrap(newValue.makerReward._value)),
            uint80(UFixed6.unwrap(newValue.longReward._value)),
            uint80(UFixed6.unwrap(newValue.shortReward._value)),
            true, // only valid versions get stored
            bytes1(0)
        );
    }
}
