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
    UFixed6 liquidationFee;
    UFixed6 minLiquidationFee;
    UFixed6 maxLiquidationFee;
    UJumpRateUtilizationCurve6 utilizationCurve;
    PController6 pController;
    UFixed6 minMaintenance;
    uint256 staleAfter;
    bool makerReceiveOnly;
    // TODO: closeToSocializeMaker
    // TODO: closeToSocializeTaker
    // TODO: takerLimit
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
    uint24 takerSkewFee;                        // <= 1677%
    uint24 takerImpactFee;                      // <= 1677%
    uint24 makerImpactFee;                      // <= 1677%
    uint48 minMaintenance;                      // <= 281m
    uint24 staleAfter;                          // <= 16m s
    bytes6 __unallocated__;

    /* slot 3 */
    uint24 liquidationFee;                      // <= 1677%
    uint48 minLiquidationFee;                   // <= 281mn
    uint48 maxLiquidationFee;                   // <= 281mn
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
            UFixed6.wrap(uint256(value.liquidationFee)),
            UFixed6.wrap(uint256(value.minLiquidationFee)),
            UFixed6.wrap(uint256(value.maxLiquidationFee)),
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
            UFixed6.wrap(uint256(value.minMaintenance)),
            uint256(value.staleAfter),
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
        if (newValue.liquidationFee.gt(UFixed6.wrap(type(uint24).max))) revert RiskParameterStorageInvalidError();
        if (newValue.minLiquidationFee.gt(UFixed6.wrap(type(uint48).max))) revert RiskParameterStorageInvalidError();
        if (newValue.maxLiquidationFee.gt(UFixed6.wrap(type(uint48).max))) revert RiskParameterStorageInvalidError();
        if (newValue.utilizationCurve.minRate.gt(UFixed6.wrap(type(uint32).max))) revert RiskParameterStorageInvalidError();
        if (newValue.utilizationCurve.maxRate.gt(UFixed6.wrap(type(uint32).max))) revert RiskParameterStorageInvalidError();
        if (newValue.utilizationCurve.targetRate.gt(UFixed6.wrap(type(uint32).max))) revert RiskParameterStorageInvalidError();
        if (newValue.utilizationCurve.targetUtilization.gt(UFixed6.wrap(type(uint32).max))) revert RiskParameterStorageInvalidError();
        if (newValue.pController.k.gt(UFixed6.wrap(type(uint40).max))) revert RiskParameterStorageInvalidError();
        if (newValue.pController.max.gt(UFixed6.wrap(type(uint32).max))) revert RiskParameterStorageInvalidError();
        if (newValue.minMaintenance.gt(UFixed6.wrap(type(uint48).max))) revert RiskParameterStorageInvalidError();
        if (newValue.staleAfter > uint256(type(uint24).max)) revert RiskParameterStorageInvalidError();

        self.value = StoredRiskParameter({
            maintenance: uint24(UFixed6.unwrap(newValue.maintenance)),
            takerFee: uint24(UFixed6.unwrap(newValue.takerFee)),
            takerSkewFee: uint24(UFixed6.unwrap(newValue.takerSkewFee)),
            takerImpactFee: uint24(UFixed6.unwrap(newValue.takerImpactFee)),
            makerFee: uint24(UFixed6.unwrap(newValue.makerFee)),
            makerImpactFee: uint24(UFixed6.unwrap(newValue.makerImpactFee)),
            makerLimit: uint48(UFixed6.unwrap(newValue.makerLimit)),
            liquidationFee: uint24(UFixed6.unwrap(newValue.liquidationFee)),
            minLiquidationFee: uint48(UFixed6.unwrap(newValue.minLiquidationFee)),
            maxLiquidationFee: uint48(UFixed6.unwrap(newValue.maxLiquidationFee)),
            utilizationCurveMinRate: uint32(UFixed6.unwrap(newValue.utilizationCurve.minRate)),
            utilizationCurveMaxRate: uint32(UFixed6.unwrap(newValue.utilizationCurve.maxRate)),
            utilizationCurveTargetRate: uint32(UFixed6.unwrap(newValue.utilizationCurve.targetRate)),
            utilizationCurveTargetUtilization: uint24(UFixed6.unwrap(newValue.utilizationCurve.targetUtilization)),
            pControllerK: uint40(UFixed6.unwrap(newValue.pController.k)),
            pControllerMax: uint32(UFixed6.unwrap(newValue.pController.max)),
            minMaintenance: uint48(UFixed6.unwrap(newValue.minMaintenance)),
            staleAfter: uint24(newValue.staleAfter),
            makerReceiveOnly: newValue.makerReceiveOnly,
            __unallocated__: bytes6(0)
        });
    }
}