// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/perennial-v2-payoff/contracts/interfaces/IPayoffProvider.sol";
import "@equilibria/perennial-v2-oracle/contracts/interfaces/IOracleProvider.sol";
import "@equilibria/root/number/types/UFixed6.sol";
import "@equilibria/root/curve/types/UJumpRateUtilizationCurve6.sol";
import "@equilibria/root-v2/contracts/PController6.sol";

/// @dev RiskParameter type
struct RiskParameter {
    UFixed6 maintenance;
    UFixed6 takerFee;
    UFixed6 takerSkewFee;
    UFixed6 takerImpactFee;
    UFixed6 makerFee;
    UFixed6 makerImpactFee;
    UFixed6 makerLimit;
    UFixed6 makerRewardRate;
    UFixed6 longRewardRate;
    UFixed6 shortRewardRate;
    UJumpRateUtilizationCurve6 utilizationCurve;
    PController6 pController;
    bool makerReceiveOnly;
}

struct StoredRiskParameter {
    /* slot 1 */
    uint48 makerLimit;                          // <= 281m
    uint40 pControllerK;                        // <= 1.1m
    uint32 utilizationCurveMinRate;             // <= 214748%
    uint32 utilizationCurveMaxRate;             // <= 214748%
    uint24 utilizationCurveTargetUtilization;   // <= 1677%
    uint24 takerFee;                            // <= 1677%
    uint24 makerFee;                            // <= 1677%
    uint24 maintenance;                         // <= 1677%
    bool makerReceiveOnly;

    /* slot 2 */
    uint32 utilizationCurveTargetRate;          // <= 214748%
    uint32 pControllerMax;                      // <= 214748%
    uint32 makerRewardRate;                     // <= 2147.48 / s
    uint32 longRewardRate;                      // <= 2147.48 / s
    uint32 shortRewardRate;                     // <= 2147.48 / s
    uint24 takerSkewFee;                        // <= 1677%
    uint24 takerImpactFee;                      // <= 1677%
    uint24 makerImpactFee;                      // <= 1677%
    bytes3 __unallocated__;
}
struct RiskParameterStorage { StoredRiskParameter value; }
using RiskParameterStorageLib for RiskParameterStorage global;

library RiskParameterStorageLib {
    error RiskParameterStorageInvalidError();

    function read(RiskParameterStorage storage self) internal view returns (RiskParameter memory) {
        StoredRiskParameter memory value = self.value;
        return RiskParameter(
            UFixed6.wrap(uint256(value.maintenance)),
            UFixed6.wrap(uint256(value.takerFee)),
            UFixed6.wrap(uint256(value.takerSkewFee)),
            UFixed6.wrap(uint256(value.takerImpactFee)),
            UFixed6.wrap(uint256(value.makerFee)),
            UFixed6.wrap(uint256(value.makerImpactFee)),
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
                UFixed6.wrap(uint256(value.pControllerK)),
                UFixed6.wrap(uint256(value.pControllerMax))
            ),
            value.makerReceiveOnly
        );
    }

    function store(RiskParameterStorage storage self, RiskParameter memory newValue) internal {
        if (newValue.maintenance.gt(UFixed6.wrap(type(uint24).max))) revert RiskParameterStorageInvalidError();
        if (newValue.takerFee.gt(UFixed6.wrap(type(uint24).max))) revert RiskParameterStorageInvalidError();
        if (newValue.takerSkewFee.gt(UFixed6.wrap(type(uint24).max))) revert RiskParameterStorageInvalidError();
        if (newValue.takerImpactFee.gt(UFixed6.wrap(type(uint24).max))) revert RiskParameterStorageInvalidError();
        if (newValue.makerFee.gt(UFixed6.wrap(type(uint24).max))) revert RiskParameterStorageInvalidError();
        if (newValue.makerImpactFee.gt(UFixed6.wrap(type(uint24).max))) revert RiskParameterStorageInvalidError();
        if (newValue.makerLimit.gt(UFixed6.wrap(type(uint48).max))) revert RiskParameterStorageInvalidError();
        if (newValue.makerRewardRate.gt(UFixed6.wrap(type(uint32).max))) revert RiskParameterStorageInvalidError();
        if (newValue.longRewardRate.gt(UFixed6.wrap(type(uint32).max))) revert RiskParameterStorageInvalidError();
        if (newValue.shortRewardRate.gt(UFixed6.wrap(type(uint32).max))) revert RiskParameterStorageInvalidError();
        if (newValue.utilizationCurve.minRate.gt(UFixed6.wrap(type(uint32).max))) revert RiskParameterStorageInvalidError();
        if (newValue.utilizationCurve.maxRate.gt(UFixed6.wrap(type(uint32).max))) revert RiskParameterStorageInvalidError();
        if (newValue.utilizationCurve.targetRate.gt(UFixed6.wrap(type(uint32).max))) revert RiskParameterStorageInvalidError();
        if (newValue.utilizationCurve.targetUtilization.gt(UFixed6.wrap(type(uint32).max))) revert RiskParameterStorageInvalidError();
        if (newValue.pController.k.gt(UFixed6.wrap(type(uint40).max))) revert RiskParameterStorageInvalidError();
        if (newValue.pController.max.gt(UFixed6.wrap(type(uint32).max))) revert RiskParameterStorageInvalidError();

        self.value = StoredRiskParameter({
            maintenance: uint24(UFixed6.unwrap(newValue.maintenance)),
            takerFee: uint24(UFixed6.unwrap(newValue.takerFee)),
            takerSkewFee: uint24(UFixed6.unwrap(newValue.takerSkewFee)),
            takerImpactFee: uint24(UFixed6.unwrap(newValue.takerImpactFee)),
            makerFee: uint24(UFixed6.unwrap(newValue.makerFee)),
            makerImpactFee: uint24(UFixed6.unwrap(newValue.makerImpactFee)),
            makerLimit: uint48(UFixed6.unwrap(newValue.makerLimit)),
            makerRewardRate: uint32(UFixed6.unwrap(newValue.makerRewardRate)),
            longRewardRate: uint32(UFixed6.unwrap(newValue.longRewardRate)),
            shortRewardRate: uint32(UFixed6.unwrap(newValue.shortRewardRate)),
            utilizationCurveMinRate: uint32(UFixed6.unwrap(newValue.utilizationCurve.minRate)),
            utilizationCurveMaxRate: uint32(UFixed6.unwrap(newValue.utilizationCurve.maxRate)),
            utilizationCurveTargetRate: uint32(UFixed6.unwrap(newValue.utilizationCurve.targetRate)),
            utilizationCurveTargetUtilization: uint24(UFixed6.unwrap(newValue.utilizationCurve.targetUtilization)),
            pControllerK: uint40(UFixed6.unwrap(newValue.pController.k)),
            pControllerMax: uint32(UFixed6.unwrap(newValue.pController.max)),
            makerReceiveOnly: newValue.makerReceiveOnly,
            __unallocated__: bytes3(0)
        });
    }
}