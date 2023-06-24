// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/perennial-v2-payoff/contracts/interfaces/IPayoffProvider.sol";
import "@equilibria/perennial-v2-oracle/contracts/interfaces/IOracleProvider.sol";
import "@equilibria/root/number/types/UFixed6.sol";
import "@equilibria/root/curve/types/UJumpRateUtilizationCurve6.sol";
import "@equilibria/root-v2/contracts/PController6.sol";

/// @dev MarketParameter type
struct MarketParameter {
    UFixed6 maintenance;
    UFixed6 fundingFee;
    UFixed6 interestFee;
    UFixed6 takerFee;
    UFixed6 takerSkewFee;
    UFixed6 takerImpactFee;
    UFixed6 makerFee;
    UFixed6 makerSkewFee;
    UFixed6 makerImpactFee;
    UFixed6 positionFee;
    UFixed6 makerLimit;
    UFixed6 makerRewardRate;
    UFixed6 longRewardRate;
    UFixed6 shortRewardRate;
    UJumpRateUtilizationCurve6 utilizationCurve;
    PController6 pController; // TODO: should these all be stored in params and not global?
    IOracleProvider oracle;
    IPayoffProvider payoff;
    bool makerReceiveOnly;
    bool closed;
}
struct StoredMarketParameter {
    /* slot 1 */
    address oracle;
    uint24 maintenance; // <= 1677%
    uint24 fundingFee;  // <= 1677%
    uint24 positionFee; // <= 1677%
    bool makerReceiveOnly;
    bool closed;
    bool fuse;

    /* slot 2 */
    address payoff;
    uint32 makerRewardRate;  // <= 2147.48 / s
    uint32 longRewardRate;   // <= 2147.48 / s
    uint32 shortRewardRate;  // <= 2147.48 / s

    /* slot 3 */
    uint48 makerLimit;                        // <= 281m
    uint32 utilizationCurveMinRate;           // <= 214748%
    uint32 utilizationCurveMaxRate;           // <= 214748%
    uint32 utilizationCurveTargetRate;        // <= 214748%
    uint24 utilizationCurveTargetUtilization; // <= 1677%
    uint24 takerFee;                          // <= 1677%
    uint24 makerFee;                          // <= 1677%
    uint24 interestFee;                       // <= 1677%
    bytes2 __unallocated1__;

    /* slot 4 */
    int32 pControllerValue;                  // <= 214748%
    uint48 pControllerK;                     // <= 281m
    int24 pControllerSkew;                   // <= 1677%
    uint32 pControllerMax;                   // <= 214748%
    uint24 takerSkewFee;                     // <= 1677%
    uint24 takerImpactFee;                   // <= 1677%
    uint24 makerSkewFee;                     // <= 1677%
    uint24 makerImpactFee;                   // <= 1677%
    bytes7 __unallocated2__;
}
struct MarketParameterStorage { StoredMarketParameter value; }
using MarketParameterStorageLib for MarketParameterStorage global;

library MarketParameterStorageLib {
    error MarketParameterStorageInvalidError();
    error MarketParameterStorageImmutableError();

    function read(MarketParameterStorage storage self) internal view returns (MarketParameter memory) {
        StoredMarketParameter memory value = self.value;
        return MarketParameter(
            UFixed6.wrap(uint256(value.maintenance)),
            UFixed6.wrap(uint256(value.fundingFee)),
            UFixed6.wrap(uint256(value.interestFee)),
            UFixed6.wrap(uint256(value.takerFee)),
            UFixed6.wrap(uint256(value.takerSkewFee)),
            UFixed6.wrap(uint256(value.takerImpactFee)),
            UFixed6.wrap(uint256(value.makerFee)),
            UFixed6.wrap(uint256(value.makerSkewFee)),
            UFixed6.wrap(uint256(value.makerImpactFee)),
            UFixed6.wrap(uint256(value.positionFee)),
            UFixed6.wrap(uint256(value.makerLimit)),
            UFixed6.wrap(uint256(value.makerRewardRate)),
            UFixed6.wrap(uint256(value.longRewardRate)),
            UFixed6.wrap(uint256(value.shortRewardRate)),
            UJumpRateUtilizationCurve6(
                UFixed6.wrap(uint256(value.utilizationCurveMinRate)),
                UFixed6.wrap(uint256(value.utilizationCurveMaxRate)),
                UFixed6.wrap(uint256(value.utilizationCurveTargetRate)),
                UFixed6.wrap(uint256(value.utilizationCurveTargetUtilization))
            ),
            PController6(
                Fixed6.wrap(int256(value.pControllerValue)),
                UFixed6.wrap(uint256(value.pControllerK)),
                Fixed6.wrap(int256(value.pControllerSkew)),
                UFixed6.wrap(uint256(value.pControllerMax))
            ),
            IOracleProvider(value.oracle),
            IPayoffProvider(value.payoff),
            value.makerReceiveOnly,
            value.closed
        );
    }

    function store(MarketParameterStorage storage self, MarketParameter memory newValue) internal {
        StoredMarketParameter memory oldValue = self.value;

        if (newValue.maintenance.gt(UFixed6.wrap(type(uint24).max))) revert MarketParameterStorageInvalidError();
        if (newValue.fundingFee.gt(UFixed6.wrap(type(uint24).max))) revert MarketParameterStorageInvalidError();
        if (newValue.interestFee.gt(UFixed6.wrap(type(uint24).max))) revert MarketParameterStorageInvalidError();
        if (newValue.takerFee.gt(UFixed6.wrap(type(uint24).max))) revert MarketParameterStorageInvalidError();
        if (newValue.takerSkewFee.gt(UFixed6.wrap(type(uint24).max))) revert MarketParameterStorageInvalidError();
        if (newValue.takerImpactFee.gt(UFixed6.wrap(type(uint24).max))) revert MarketParameterStorageInvalidError();
        if (newValue.makerFee.gt(UFixed6.wrap(type(uint24).max))) revert MarketParameterStorageInvalidError();
        if (newValue.makerSkewFee.gt(UFixed6.wrap(type(uint24).max))) revert MarketParameterStorageInvalidError();
        if (newValue.makerImpactFee.gt(UFixed6.wrap(type(uint24).max))) revert MarketParameterStorageInvalidError();
        if (newValue.positionFee.gt(UFixed6.wrap(type(uint24).max))) revert MarketParameterStorageInvalidError();
        if (newValue.makerLimit.gt(UFixed6.wrap(type(uint48).max))) revert MarketParameterStorageInvalidError();
        if (newValue.makerRewardRate.gt(UFixed6.wrap(type(uint32).max))) revert MarketParameterStorageInvalidError();
        if (newValue.longRewardRate.gt(UFixed6.wrap(type(uint32).max))) revert MarketParameterStorageInvalidError();
        if (newValue.shortRewardRate.gt(UFixed6.wrap(type(uint32).max))) revert MarketParameterStorageInvalidError();
        if (newValue.utilizationCurve.minRate.gt(UFixed6.wrap(type(uint32).max))) revert MarketParameterStorageInvalidError();
        if (newValue.utilizationCurve.maxRate.gt(UFixed6.wrap(type(uint32).max))) revert MarketParameterStorageInvalidError();
        if (newValue.utilizationCurve.targetRate.gt(UFixed6.wrap(type(uint32).max))) revert MarketParameterStorageInvalidError();
        if (newValue.utilizationCurve.targetUtilization.gt(UFixed6.wrap(type(uint32).max))) revert MarketParameterStorageInvalidError();
        if (newValue.pController.value.gt(Fixed6.wrap(type(int32).max))) revert MarketParameterStorageInvalidError();
        if (newValue.pController.value.lt(Fixed6.wrap(type(int32).min))) revert MarketParameterStorageInvalidError();
        if (newValue.pController._k.gt(UFixed6.wrap(type(uint48).max))) revert MarketParameterStorageInvalidError();
        if (newValue.pController._skew.gt(Fixed6.wrap(type(int24).max))) revert MarketParameterStorageInvalidError();
        if (newValue.pController._skew.lt(Fixed6.wrap(type(int24).min))) revert MarketParameterStorageInvalidError();
        if (newValue.pController._max.gt(UFixed6.wrap(type(uint32).max))) revert MarketParameterStorageInvalidError();

        if (oldValue.fuse && address(newValue.oracle) != oldValue.oracle) revert MarketParameterStorageImmutableError();
        if (oldValue.fuse && address(newValue.payoff) != oldValue.payoff) revert MarketParameterStorageImmutableError();

        self.value = StoredMarketParameter({
            maintenance: uint24(UFixed6.unwrap(newValue.maintenance)),
            fundingFee: uint24(UFixed6.unwrap(newValue.fundingFee)),
            interestFee: uint24(UFixed6.unwrap(newValue.interestFee)),
            takerFee: uint24(UFixed6.unwrap(newValue.takerFee)),
            takerSkewFee: uint24(UFixed6.unwrap(newValue.takerSkewFee)),
            takerImpactFee: uint24(UFixed6.unwrap(newValue.takerImpactFee)),
            makerFee: uint24(UFixed6.unwrap(newValue.makerFee)),
            makerSkewFee: uint24(UFixed6.unwrap(newValue.makerSkewFee)),
            makerImpactFee: uint24(UFixed6.unwrap(newValue.makerImpactFee)),
            positionFee: uint24(UFixed6.unwrap(newValue.positionFee)),
            makerLimit: uint48(UFixed6.unwrap(newValue.makerLimit)),
            makerRewardRate: uint32(UFixed6.unwrap(newValue.makerRewardRate)),
            longRewardRate: uint32(UFixed6.unwrap(newValue.longRewardRate)),
            shortRewardRate: uint32(UFixed6.unwrap(newValue.shortRewardRate)),
            utilizationCurveMinRate: uint32(UFixed6.unwrap(newValue.utilizationCurve.minRate)),
            utilizationCurveMaxRate: uint32(UFixed6.unwrap(newValue.utilizationCurve.maxRate)),
            utilizationCurveTargetRate: uint32(UFixed6.unwrap(newValue.utilizationCurve.targetRate)),
            utilizationCurveTargetUtilization: uint24(UFixed6.unwrap(newValue.utilizationCurve.targetUtilization)),
            pControllerValue: int32(Fixed6.unwrap(newValue.pController.value)),
            pControllerK: uint48(UFixed6.unwrap(newValue.pController._k)),
            pControllerSkew: int24(Fixed6.unwrap(newValue.pController._skew)),
            pControllerMax: uint32(UFixed6.unwrap(newValue.pController._max)),
            oracle: address(newValue.oracle),
            payoff: address(newValue.payoff),
            makerReceiveOnly: newValue.makerReceiveOnly,
            closed: newValue.closed,
            fuse: true,
            __unallocated1__: bytes2(0),
            __unallocated2__: bytes7(0)
        });
    }
}