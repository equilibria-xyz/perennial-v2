// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "@equilibria/root-v2/contracts/Accumulator6.sol";
import "@equilibria/root-v2/contracts/UAccumulator6.sol";
import "./ProtocolParameter.sol";
import "./MarketParameter.sol";
import "./Fee.sol";
import "./Order.sol";

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

//TODO: natspec on 'position'

/**
 * @title VersionLib
 * @notice Library that manages global versioned accumulator state.
 * @dev Manages two accumulators: value and reward. The value accumulator measures the change in position value
 *      over time. The reward accumulator measures the change in liquidity ownership over time (for tracking
 *      incentivization rewards).
 *
 *      Both accumulators are stamped for historical lookup anytime there is a global settlement, which services
 *      the delayed-order accounting. It is not guaranteed that every version will have a value stamped, but
 *      only versions when a settlement occurred are needed for this historical computation.
 */
library VersionLib {
    /**
     * @notice Globally accumulates position fees since last oracle update
     * @dev Position fees are calculated based on the price at `latestOracleVersion` as that is the price used to
     *      calculate the user's fee total. In the event that settlement is occurring over multiple oracle versions
     *      (i.e. from a -> b -> c) it is safe to use the latestOracleVersion because in the a -> b case, a is always
     *      b - 1, and in the b -> c case the `PrePosition` is always empty so this is skipped.
     * @return protocolFee The position fee that is retained by the protocol and product
     */
    function update(
        Version memory self,
        Order memory order,
        UFixed6 positionFee,
        MarketParameter memory marketParameter
    ) internal pure returns (UFixed6 protocolFee) {
        // If there are no makers to distribute the taker's position fee to, give it to the protocol
        if (order.maker.isZero()) return positionFee;

        protocolFee = marketParameter.positionFee.mul(positionFee);
        positionFee = positionFee.sub(protocolFee);
        self.makerValue.increment(Fixed6Lib.from(positionFee), order.maker);
    }

    /**
     * @notice Accumulates the global state for the period from `fromVersion` to `toOracleVersion`
     * @param self The struct to operate on
     */
    function accumulate(
        Version memory self,
        Order memory order,
        OracleVersion memory fromOracleVersion,
        OracleVersion memory toOracleVersion,
        ProtocolParameter memory protocolParameter,
        MarketParameter memory marketParameter
    ) internal pure returns (UFixed6 fundingFeeAmount) {
        if (marketParameter.closed) return UFixed6Lib.ZERO;

        // accumulate funding
        fundingFeeAmount =
            _accumulateFunding(self, order, fromOracleVersion, toOracleVersion, protocolParameter, marketParameter);

        // accumulate P&L
        _accumulatePNL(self, order, fromOracleVersion, toOracleVersion);

        // accumulate reward
        _accumulateReward(self, order, fromOracleVersion, toOracleVersion, marketParameter);
    }

    /**
     * @notice Globally accumulates all funding since last oracle update
     * @dev If an oracle version is skipped due to no orders, funding will continue to be
     *      pegged to the price of the last snapshotted oracleVersion until a new one is accumulated.
     *      This is an acceptable approximation.
     * @return fundingFee The total fee accrued from funding accumulation
     */
    function _accumulateFunding(
        Version memory self,
        Order memory order,
        OracleVersion memory fromOracleVersion,
        OracleVersion memory toOracleVersion,
        ProtocolParameter memory protocolParameter,
        MarketParameter memory marketParameter
    ) private pure returns (UFixed6 fundingFee) {
        if (order.magnitude().isZero()) return UFixed6Lib.ZERO;

        UFixed6 notional = order.takerSocialized().mul(fromOracleVersion.price.abs());
        UFixed6 funding = marketParameter.utilizationCurve.accumulate(
            order.utilization(),
            fromOracleVersion.timestamp,
            toOracleVersion.timestamp,
            notional
        );
        fundingFee = UFixed6Lib.max(marketParameter.fundingFee, protocolParameter.minFundingFee).mul(funding);
        UFixed6 fundingWithoutFee = funding.sub(fundingFee);
        UFixed6 spread = order.spread().max(protocolParameter.minSpread);
        UFixed6 fundingWithoutFeeMaker = fundingWithoutFee.mul(spread);
        UFixed6 fundingWithoutFeeTaker = fundingWithoutFee.sub(fundingWithoutFeeMaker);

        if (order.long.gt(order.short)) {
            if (!order.long.isZero()) self.longValue.decrement(Fixed6Lib.from(funding), order.long);
            if (!order.short.isZero()) self.shortValue.increment(Fixed6Lib.from(fundingWithoutFeeTaker), order.short);
        } else {
            if (!order.long.isZero()) self.longValue.increment(Fixed6Lib.from(fundingWithoutFeeTaker), order.long);
            if (!order.short.isZero()) self.shortValue.decrement(Fixed6Lib.from(funding), order.short);
        }
        if (!order.maker.isZero()) self.makerValue.increment(Fixed6Lib.from(fundingWithoutFeeMaker), order.maker);
    }

    /**
     * @notice Globally accumulates position P&L since last oracle update
     */
    function _accumulatePNL(
        Version memory self,
        Order memory order,
        OracleVersion memory fromOracleVersion,
        OracleVersion memory toOracleVersion
    ) private pure {
        if (order.magnitude().isZero() || order.maker.isZero()) return;

        Fixed6 totalLongDelta = toOracleVersion.price.sub(fromOracleVersion.price)
            .mul(Fixed6Lib.from(order.longSocialized()));
        Fixed6 totalShortDelta = fromOracleVersion.price.sub(toOracleVersion.price)
            .mul(Fixed6Lib.from(order.shortSocialized()));
        Fixed6 totalMakerDelta = totalLongDelta.add(totalShortDelta);

        if (!order.long.isZero()) self.longValue.increment(totalLongDelta, order.long);
        if (!order.short.isZero()) self.shortValue.increment(totalShortDelta, order.short);
        if (!order.maker.isZero()) self.makerValue.decrement(totalMakerDelta, order.maker);
    }

    /**
     * @notice Globally accumulates position's reward since last oracle update
     * @dev This is used to compute incentivization rewards based on market participation
     */
    function _accumulateReward(
        Version memory self,
        Order memory order,
        OracleVersion memory fromOracleVersion,
        OracleVersion memory toOracleVersion,
        MarketParameter memory marketParameter
    ) private pure {
        UFixed6 elapsed = UFixed6Lib.from(toOracleVersion.timestamp - fromOracleVersion.timestamp);
        //TODO: refunded rewards here will effect the "auto-close functionality"

        if (!order.maker.isZero())
            self.makerReward.increment(elapsed.mul(marketParameter.makerRewardRate), order.maker);
        if (!order.long.isZero())
            self.longReward.increment(elapsed.mul(marketParameter.longRewardRate), order.long);
        if (!order.short.isZero())
            self.shortReward.increment(elapsed.mul(marketParameter.shortRewardRate), order.short);
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
