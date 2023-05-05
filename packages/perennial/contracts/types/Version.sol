// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root-v2/contracts/Accumulator6.sol";
import "@equilibria/root-v2/contracts/UAccumulator6.sol";
import "./ProtocolParameter.sol";
import "./MarketParameter.sol";
import "./Fee.sol";
import "./Position.sol";

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
    int80 _makerValue;
    int88 _longValue;
    int88 _shortValue;
    uint80 _makerReward;
    uint88 _longReward;
    uint88 _shortReward;
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
        Position memory fromPosition,
        Position memory toPosition,
        OracleVersion memory fromOracleVersion,
        OracleVersion memory toOracleVersion,
        ProtocolParameter memory protocolParameter,
        MarketParameter memory marketParameter
    ) internal pure returns (UFixed6 fee) {
        if (marketParameter.closed) return UFixed6Lib.ZERO;

        UFixed6 fundingFee; UFixed6 positionFee;

        // accumulate position
        positionFee = _accumulatePositionFee(self, fromPosition, toPosition, marketParameter);

        // accumulate funding
        fundingFee =
            _accumulateFunding(self, fromPosition, fromOracleVersion, toOracleVersion, protocolParameter, marketParameter);

        // accumulate P&L
        _accumulatePNL(self, fromPosition, fromOracleVersion, toOracleVersion);

        // accumulate reward
        _accumulateReward(self, fromPosition, fromOracleVersion, toOracleVersion, marketParameter);

        return positionFee.add(fundingFee);
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
        if (toPosition.maker.isZero()) return positionFee;

        UFixed6 fee = toPosition.fee.sub(fromPosition.fee);
        positionFee = marketParameter.positionFee.mul(fee);
        UFixed6 makerFee = fee.sub(positionFee);
        self.makerValue.increment(Fixed6Lib.from(makerFee), toPosition.maker);
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
        Position memory position,
        OracleVersion memory fromOracleVersion,
        OracleVersion memory toOracleVersion,
        ProtocolParameter memory protocolParameter,
        MarketParameter memory marketParameter
    ) private pure returns (UFixed6 fundingFee) {
        if (position.major().isZero()) return UFixed6Lib.ZERO;

        UFixed6 notional = position.takerSocialized().mul(fromOracleVersion.price.abs());
        UFixed6 funding = marketParameter.utilizationCurve.accumulate(
            position.utilization(),
            fromOracleVersion.timestamp,
            toOracleVersion.timestamp,
            notional
        );
        fundingFee = UFixed6Lib.max(marketParameter.fundingFee, protocolParameter.minFundingFee).mul(funding);
        UFixed6 fundingWithoutFee = funding.sub(fundingFee);
        UFixed6 spread = position.spread().max(protocolParameter.minSpread);
        UFixed6 fundingWithoutFeeMaker = fundingWithoutFee.mul(spread);
        UFixed6 fundingWithoutFeeTaker = fundingWithoutFee.sub(fundingWithoutFeeMaker);

        if (position.long.gt(position.short)) {
            if (!position.long.isZero()) self.longValue.decrement(Fixed6Lib.from(funding), position.long);
            if (!position.short.isZero()) self.shortValue.increment(Fixed6Lib.from(fundingWithoutFeeTaker), position.short);
        } else {
            if (!position.long.isZero()) self.longValue.increment(Fixed6Lib.from(fundingWithoutFeeTaker), position.long);
            if (!position.short.isZero()) self.shortValue.decrement(Fixed6Lib.from(funding), position.short);
        }
        if (!position.maker.isZero()) self.makerValue.increment(Fixed6Lib.from(fundingWithoutFeeMaker), position.maker);
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
        MarketParameter memory marketParameter
    ) private pure {
        UFixed6 elapsed = UFixed6Lib.from(toOracleVersion.timestamp - fromOracleVersion.timestamp);
        //TODO: refunded rewards here will effect the "auto-close functionality"

        if (!position.maker.isZero())
            self.makerReward.increment(elapsed.mul(marketParameter.makerRewardRate), position.maker);
        if (!position.long.isZero())
            self.longReward.increment(elapsed.mul(marketParameter.longRewardRate), position.long);
        if (!position.short.isZero())
            self.shortReward.increment(elapsed.mul(marketParameter.shortRewardRate), position.short);
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
            UAccumulator6(UFixed6.wrap(uint256(storedValue._shortReward)))
        );
    }

    function store(VersionStorage storage self, Version memory newValue) internal {
        if (newValue.makerValue._value.gt(Fixed6Lib.MAX_80)) revert VersionStorageInvalidError();
        if (newValue.makerValue._value.lt(Fixed6Lib.MIN_80)) revert VersionStorageInvalidError();
        if (newValue.longValue._value.gt(Fixed6Lib.MAX_88)) revert VersionStorageInvalidError();
        if (newValue.longValue._value.lt(Fixed6Lib.MIN_88)) revert VersionStorageInvalidError();
        if (newValue.shortValue._value.gt(Fixed6Lib.MAX_88)) revert VersionStorageInvalidError();
        if (newValue.shortValue._value.lt(Fixed6Lib.MIN_88)) revert VersionStorageInvalidError();
        if (newValue.makerReward._value.gt(UFixed6Lib.MAX_80)) revert VersionStorageInvalidError();
        if (newValue.longReward._value.gt(UFixed6Lib.MAX_88)) revert VersionStorageInvalidError();
        if (newValue.shortReward._value.gt(UFixed6Lib.MAX_88)) revert VersionStorageInvalidError();

        self.value = StoredVersion(
            int80(Fixed6.unwrap(newValue.makerValue._value)),
            int88(Fixed6.unwrap(newValue.longValue._value)),
            int88(Fixed6.unwrap(newValue.shortValue._value)),
            uint80(UFixed6.unwrap(newValue.makerReward._value)),
            uint88(UFixed6.unwrap(newValue.longReward._value)),
            uint88(UFixed6.unwrap(newValue.shortReward._value))
        );
    }
}
