// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "@equilibria/root-v2/contracts/Accumulator6.sol";
import "@equilibria/root-v2/contracts/UAccumulator6.sol";
import "./Position.sol";
import "./ProtocolParameter.sol";
import "./MarketParameter.sol";
import "./Fee.sol";

/// @dev Version type
struct Version {
    Accumulator6 makerValue;
    Accumulator6 longValue;
    Accumulator6 shortValue;
    UAccumulator6 makerReward;
    UAccumulator6 longReward;
    UAccumulator6 shortReward;
}
using VersionLib for Version global;
struct StoredVersion {
    int88 _makerValue;
    int80 _longValue;
    int80 _shortValue;
    uint88 _makerReward;
    uint80 _longReward;
    uint80 _shortReward;
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
     * @notice Globally accumulates position fees since last oracle update
     * @dev Position fees are calculated based on the price at `latestOracleVersion` as that is the price used to
     *      calculate the user's fee total. In the event that settlement is occurring over multiple oracle versions
     *      (i.e. from a -> b -> c) it is safe to use the latestOracleVersion because in the a -> b case, a is always
     *      b - 1, and in the b -> c case the `PrePosition` is always empty so this is skipped.
     * @return takerMarketFee The position fee that is retained by the protocol and product
     */
    function update(
        Version memory self,
        Position memory position,
        UFixed6 takerFee,
        MarketParameter memory marketParameter
    ) internal pure returns (UFixed6 takerMarketFee) {
        UFixed6 takerProtocolFee = marketParameter.positionFee.mul(takerFee);
        takerMarketFee = takerFee.sub(takerProtocolFee);

        // If there are makers to distribute the taker's position fee to, distribute. Otherwise give it to the protocol
        if (position.maker.isZero()) takerMarketFee = takerMarketFee.add(takerFee);
        else self.makerValue.increment(Fixed6Lib.from(takerFee), position.maker);
    }

    /**
     * @notice Accumulates the global state for the period from `fromVersion` to `toOracleVersion`
     * @param self The struct to operate on
     */
    function accumulate(
        Version memory self,
        Position memory position,
        OracleVersion memory fromOracleVersion,
        OracleVersion memory toOracleVersion,
        ProtocolParameter memory protocolParameter,
        MarketParameter memory marketParameter
    ) internal pure returns (UFixed6 fundingFeeAmount) {
        if (marketParameter.closed) return UFixed6Lib.ZERO;

        // accumulate funding
        fundingFeeAmount =
            _accumulateFunding(self, position, fromOracleVersion, toOracleVersion, protocolParameter, marketParameter);

        // accumulate position
        _accumulatePosition(self, position, fromOracleVersion, toOracleVersion, marketParameter);

        // accumulate reward
        _accumulateReward(self, position, fromOracleVersion, toOracleVersion, marketParameter);
    }

    /**
     * @notice Globally accumulates all funding since last oracle update
     * @dev If an oracle version is skipped due to no pre positions, funding will continue to be
     *      pegged to the price of the last snapshotted oracleVersion until a new one is accumulated.
     *      This is an acceptable approximation.
     * @return fundingFeeAmount The total fee accrued from funding accumulation
     */
    function _accumulateFunding(
        Version memory self,
        Position memory position,
        OracleVersion memory fromOracleVersion,
        OracleVersion memory toOracleVersion,
        ProtocolParameter memory protocolParameter,
        MarketParameter memory marketParameter
    ) private pure returns (UFixed6 fundingFeeAmount) {
        if (position.taker.isZero() || position.maker.isZero()) return UFixed6Lib.ZERO;

        // TODO: new funding rate logic
//        UFixed6 takerNotional = Fixed6Lib.from(position.taker).mul(fromOracleVersion.price).abs();
//        UFixed6 socializedTakerNotional = takerNotional.mul(position.socializationFactor());
//        Fixed6 fundingAccumulated = marketParameter.utilizationCurve.accumulate(
//            position.utilization(),
//            fromOracleVersion.timestamp,
//            toOracleVersion.timestamp,
//            socializedTakerNotional
//        );
//        UFixed6 boundedFundingFee = UFixed6Lib.max(marketParameter.fundingFee, protocolParameter.minFundingFee);
//        fundingFeeAmount = fundingAccumulated.abs().mul(boundedFundingFee);
//
//        Fixed6 fundingAccumulatedWithoutFee = Fixed6Lib.from(
//            fundingAccumulated.sign(),
//            fundingAccumulated.abs().sub(fundingFeeAmount)
//        );
//
//        bool makerPaysFunding = fundingAccumulated.sign() < 0;
//        self.makerValue.increment(
//            makerPaysFunding ? fundingAccumulated : fundingAccumulatedWithoutFee, position.maker);
//        self.takerValue.decrement(
//            makerPaysFunding ? fundingAccumulatedWithoutFee : fundingAccumulated, position.taker);
    }

    /**
     * @notice Globally accumulates position PNL since last oracle update
     */
    function _accumulatePosition(
        Version memory self,
        Position memory position,
        OracleVersion memory fromOracleVersion,
        OracleVersion memory toOracleVersion,
        MarketParameter memory marketParameter
    ) private pure {
        if (position.taker.isZero() || position.maker.isZero()) return;

        Fixed6 totalLongDelta = toOracleVersion.price.sub(fromOracleVersion.price)
            .mul(Fixed6Lib.from(position.long.mul(position.socializationFactorLong())));
        Fixed6 totalShortDelta = fromOracleVersion.price.sub(toOracleVersion.price)
            .mul(Fixed6Lib.from(position.short.mul(position.socializationFactorShort())));

        self.longValue.increment(totalLongDelta, position.long);
        self.shortValue.increment(totalShortDelta, position.short);
        self.makerValue.decrement(totalLongDelta.add(totalShortDelta), position.maker);
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
    ) private pure {
        UFixed6 elapsed = UFixed6Lib.from(toOracleVersion.timestamp - fromOracleVersion.timestamp);

        if (!position.maker.isZero())
            self.makerReward.increment(elapsed.mul(marketParameter.makerRewardRate), position.maker);
<<<<<<< HEAD
        if (!position.taker.isZero())
            self.takerReward.increment(elapsed.mul(marketParameter.takerRewardRate), position.taker);
=======
        if (!position.long.isZero())
            self.longReward.increment(elapsed.mul(marketParameter.longRewardRate), position.long);
        if (!position.short.isZero())
            self.shortReward.increment(elapsed.mul(marketParameter.shortRewardRate), position.short);
>>>>>>> 5a9bf3a (update state)
    }
}

library VersionStorageLib {
    error VersionStorageInvalidError();

    function read(VersionStorage storage self) internal view returns (Version memory) {
        StoredVersion memory storedValue =  self.value;
        return Version(
            Accumulator6(Fixed6.wrap(int256(storedValue._makerValue))),
            Accumulator6(Fixed6.wrap(int256(storedValue._longValue))),
            Accumulator6(Fixed6.wrap(int256(storedValue._shortValue))),
            UAccumulator6(UFixed6.wrap(uint256(storedValue._makerReward))),
            UAccumulator6(UFixed6.wrap(uint256(storedValue._longReward))),
            UAccumulator6(UFixed6.wrap(uint256(storedValue._shortReward)))
        );
    }

    function store(VersionStorage storage self, Version memory newValue) internal {
        if (newValue.makerValue._value.gt(Fixed6Lib.MAX_88)) revert VersionStorageInvalidError();
        if (newValue.makerValue._value.lt(Fixed6Lib.MIN_88)) revert VersionStorageInvalidError();
        if (newValue.longValue._value.gt(Fixed6Lib.MAX_80)) revert VersionStorageInvalidError();
        if (newValue.longValue._value.lt(Fixed6Lib.MAX_80)) revert VersionStorageInvalidError();
        if (newValue.shortValue._value.gt(Fixed6Lib.MAX_80)) revert VersionStorageInvalidError();
        if (newValue.shortValue._value.lt(Fixed6Lib.MAX_80)) revert VersionStorageInvalidError();
        if (newValue.makerReward._value.gt(UFixed6Lib.MAX_88)) revert VersionStorageInvalidError();
        if (newValue.longReward._value.gt(UFixed6Lib.MAX_80)) revert VersionStorageInvalidError();
        if (newValue.shortReward._value.gt(UFixed6Lib.MAX_80)) revert VersionStorageInvalidError();

        self.value = StoredVersion(
            int88(Fixed6.unwrap(newValue.makerValue._value)),
            int80(Fixed6.unwrap(newValue.longValue._value)),
            int80(Fixed6.unwrap(newValue.shortValue._value)),
            uint88(UFixed6.unwrap(newValue.makerReward._value)),
            uint80(UFixed6.unwrap(newValue.longReward._value)),
            uint80(UFixed6.unwrap(newValue.shortReward._value))
        );
    }
}
