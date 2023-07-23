// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/UFixed6.sol";
import "@equilibria/root/utilization/types/UJumpRateUtilizationCurve6.sol";
import "@equilibria/root/pid/types/PController6.sol";
import "../interfaces/IOracleProvider.sol";
import "../interfaces/IPayoffProvider.sol";
import "./ProtocolParameter.sol";

/// @dev RiskParameter type
struct RiskParameter {
    /// @dev The minimum amount of collateral that must be maintained as a percentage of notional
    UFixed6 maintenance;

    /// @dev The percentage fee on the notional that is charged when a long or short position is open or closed
    UFixed6 takerFee;

    /// @dev The additional percentage that is added scaled by the change in skew
    UFixed6 takerSkewFee;

    /// @dev The additional percentage that is added scaled by the change in impact
    UFixed6 takerImpactFee;

    /// @dev The percentage fee on the notional that is charged when a maker position is open or closed
    UFixed6 makerFee;

    /// @dev The additional percentage that is added scaled by the change in utilization
    UFixed6 makerImpactFee;

    /// @dev The maximum amount of maker positions that opened
    UFixed6 makerLimit;

    /// @dev The minimum limit of the efficiency metric
    UFixed6 efficiencyLimit;

    /// @dev The percentage fee on the notional that is charged when a position is liquidated
    UFixed6 liquidationFee;

    /// @dev The minimum fixed amount that is charged when a position is liquidated
    UFixed6 minLiquidationFee;

    /// @dev The maximum fixed amount that is charged when a position is liquidated
    UFixed6 maxLiquidationFee;

    /// @dev The utilization curve that is used to compute maker interest
    UJumpRateUtilizationCurve6 utilizationCurve;

    /// @dev The p controller that is used to compute long-short funding
    PController6 pController;

    /// @dev The minimum fixed amount that is required for maintenance
    UFixed6 minMaintenance;

    /// @dev A virtual amount that is added to long and short for the purposes of skew calculation
    UFixed6 virtualTaker;

    /// @dev The maximum amount of time since the latest oracle version that update may still be called
    uint256 staleAfter;

    /// @dev Whether or not the maker should always receive positive funding
    bool makerReceiveOnly;
}
struct StoredRiskParameter {
    /* slot 0 */
    uint24 maintenance;                         // <= 1677%
    uint24 takerFee;                            // <= 1677%
    uint24 takerSkewFee;                        // <= 1677%
    uint24 takerImpactFee;                      // <= 1677%
    uint24 makerFee;                            // <= 1677%
    uint24 makerImpactFee;                      // <= 1677%
    uint48 makerLimit;                          // <= 281m
    uint24 efficiencyLimit;                     // <= 1677%
    bytes5 __unallocated0__;

    /* slot 1 */
    uint24 liquidationFee;                      // <= 1677%
    uint48 minLiquidationFee;                   // <= 281mn
    uint48 maxLiquidationFee;                   // <= 281mn
    uint32 utilizationCurveMinRate;             // <= 214748%
    uint32 utilizationCurveMaxRate;             // <= 214748%
    uint32 utilizationCurveTargetRate;          // <= 214748%
    uint24 utilizationCurveTargetUtilization;   // <= 1677%
    bytes2 __unallocated1__;

    /* slot 2 */
    uint48 pControllerK;                        // <= 281m
    uint32 pControllerMax;                      // <= 214748%
    uint48 minMaintenance;                      // <= 281m
    uint64 virtualTaker;                        // <= 18.44t
    uint24 staleAfter;                          // <= 16m s
    bool makerReceiveOnly;
    bytes4 __unallocated2__;
}
struct RiskParameterStorage { uint256 slot0; uint256 slot1; uint256 slot2; }
using RiskParameterStorageLib for RiskParameterStorage global;

//    struct StoredRiskParameter {
//        /* slot 0 */
//        uint24 maintenance;                         // <= 1677%
//        uint24 takerFee;                            // <= 1677%
//        uint24 takerSkewFee;                        // <= 1677%
//        uint24 takerImpactFee;                      // <= 1677%
//        uint24 makerFee;                            // <= 1677%
//        uint24 makerImpactFee;                      // <= 1677%
//        uint48 makerLimit;                          // <= 281m
//        uint24 efficiencyLimit;                     // <= 1677%
//
//        /* slot 1 */
//        uint24 liquidationFee;                      // <= 1677%
//        uint48 minLiquidationFee;                   // <= 281mn
//        uint48 maxLiquidationFee;                   // <= 281mn
//        uint32 utilizationCurveMinRate;             // <= 214748%
//        uint32 utilizationCurveMaxRate;             // <= 214748%
//        uint32 utilizationCurveTargetRate;          // <= 214748%
//        uint24 utilizationCurveTargetUtilization;   // <= 1677%
//
//        /* slot 2 */
//        uint48 pControllerK;                        // <= 281m
//        uint32 pControllerMax;                      // <= 214748%
//        uint48 minMaintenance;                      // <= 281m
//        uint64 virtualTaker;                        // <= 18.44t
//        uint24 staleAfter;                          // <= 16m s
//        bool makerReceiveOnly;
//    }
library RiskParameterStorageLib {
    error RiskParameterStorageInvalidError();


    function read(RiskParameterStorage storage self) internal view returns (RiskParameter memory) {
        (uint256 slot0, uint256 slot1, uint256 slot2) = (self.slot0, self.slot1, self.slot2);
        return RiskParameter(
            UFixed6.wrap(uint256(       slot0 << (256 - 24)) >> (256 - 24)),
            UFixed6.wrap(uint256(       slot0 << (256 - 24 - 24)) >> (256 - 24)),
            UFixed6.wrap(uint256(       slot0 << (256 - 24 - 24 - 24)) >> (256 - 24)),
            UFixed6.wrap(uint256(       slot0 << (256 - 24 - 24 - 24 - 24)) >> (256 - 24)),
            UFixed6.wrap(uint256(       slot0 << (256 - 24 - 24 - 24 - 24 - 24)) >> (256 - 24)),
            UFixed6.wrap(uint256(       slot0 << (256 - 24 - 24 - 24 - 24 - 24 - 24)) >> (256 - 24)),
            UFixed6.wrap(uint256(       slot0 << (256 - 24 - 24 - 24 - 24 - 24 - 24 - 48)) >> (256 - 48)),
            UFixed6.wrap(uint256(       slot0 << (256 - 24 - 24 - 24 - 24 - 24 - 24 - 48 - 24)) >> (256 - 24)),

            UFixed6.wrap(uint256(       slot1 << (256 - 24)) >> (256 - 24)),
            UFixed6.wrap(uint256(       slot1 << (256 - 24 - 48)) >> (256 - 48)),
            UFixed6.wrap(uint256(       slot1 << (256 - 24 - 48 - 48)) >> (256 - 48)),
            UJumpRateUtilizationCurve6(
                UFixed6.wrap(uint256(   slot1 << (256 - 24 - 48 - 48 - 32)) >> (256 - 32)),
                UFixed6.wrap(uint256(   slot1 << (256 - 24 - 48 - 48 - 32 - 32)) >> (256 - 32)),
                UFixed6.wrap(uint256(   slot1 << (256 - 24 - 48 - 48 - 32 - 32 - 32)) >> (256 - 32)),
                UFixed6.wrap(uint256(   slot1 << (256 - 24 - 48 - 48 - 32 - 32 - 32 - 24)) >> (256 - 24))
            ),

            PController6(
                UFixed6.wrap(uint256(   slot2 << (256 - 48)) >> (256 - 48)),
                UFixed6.wrap(uint256(   slot2 << (256 - 48 - 32)) >> (256 - 32))
            ),
            UFixed6.wrap(uint256(       slot2 << (256 - 48 - 32 - 48)) >> (256 - 48)),
            UFixed6.wrap(uint256(       slot2 << (256 - 48 - 32 - 48 - 64)) >> (256 - 64)),
                         uint256(       slot2 << (256 - 48 - 32 - 48 - 64 - 24)) >> (256 - 24),
            0 !=        (uint256(       slot2 << (256 - 48 - 32 - 48 - 64 - 24 - 8)) >> (256 - 8))
        );
    }

    function validate(RiskParameter memory self, ProtocolParameter memory protocolParameter) internal pure {
        if (
            self.takerFee.max(self.takerSkewFee).max(self.takerImpactFee).max(self.makerFee).max(self.makerImpactFee)
            .gt(protocolParameter.maxFee)
        ) revert RiskParameterStorageInvalidError();

        if (
            self.minLiquidationFee.max(self.maxLiquidationFee).max(self.minMaintenance)
            .gt(protocolParameter.maxFeeAbsolute)
        ) revert RiskParameterStorageInvalidError();

        if (self.liquidationFee.gt(protocolParameter.maxCut)) revert RiskParameterStorageInvalidError();

        if (
            self.utilizationCurve.minRate.max(self.utilizationCurve.maxRate).max(self.utilizationCurve.targetRate).max(self.pController.max)
            .gt(protocolParameter.maxRate)
        ) revert RiskParameterStorageInvalidError();

        if (self.maintenance.lt(protocolParameter.minMaintenance)) revert RiskParameterStorageInvalidError();

        if (self.efficiencyLimit.lt(protocolParameter.minEfficiency)) revert RiskParameterStorageInvalidError();

        if (self.utilizationCurve.targetUtilization.gt(UFixed6Lib.ONE)) revert RiskParameterStorageInvalidError();

        if (self.minMaintenance.lt(self.minLiquidationFee)) revert RiskParameterStorageInvalidError();
    }

    function validateAndStore(
        RiskParameterStorage storage self,
        RiskParameter memory newValue,
        ProtocolParameter memory protocolParameter
    ) internal {
        validate(newValue, protocolParameter);

        if (newValue.makerLimit.gt(UFixed6.wrap(type(uint48).max))) revert RiskParameterStorageInvalidError();
        if (newValue.pController.k.gt(UFixed6.wrap(type(uint48).max))) revert RiskParameterStorageInvalidError();
        if (newValue.virtualTaker.gt(UFixed6.wrap(type(uint64).max))) revert RiskParameterStorageInvalidError();
        if (newValue.staleAfter > uint256(type(uint24).max)) revert RiskParameterStorageInvalidError();

        uint256 encoded0 =
            uint256(UFixed6.unwrap(newValue.maintenance)        << (256 - 24)) >> (256 - 24) |
            uint256(UFixed6.unwrap(newValue.takerFee)           << (256 - 24)) >> (256 - 24 - 24) |
            uint256(UFixed6.unwrap(newValue.takerSkewFee)       << (256 - 24)) >> (256 - 24 - 24 - 24) |
            uint256(UFixed6.unwrap(newValue.takerImpactFee)     << (256 - 24)) >> (256 - 24 - 24 - 24 - 24) |
            uint256(UFixed6.unwrap(newValue.makerFee)           << (256 - 24)) >> (256 - 24 - 24 - 24 - 24 - 24) |
            uint256(UFixed6.unwrap(newValue.makerImpactFee)     << (256 - 24)) >> (256 - 24 - 24 - 24 - 24 - 24 - 24) |
            uint256(UFixed6.unwrap(newValue.makerLimit)         << (256 - 48)) >> (256 - 24 - 24 - 24 - 24 - 24 - 24 - 48) |
            uint256(UFixed6.unwrap(newValue.efficiencyLimit)    << (256 - 24)) >> (256 - 24 - 24 - 24 - 24 - 24 - 24 - 48 - 24);

        uint256 encoded1 =
            uint256(UFixed6.unwrap(newValue.liquidationFee)                     << (256 - 24)) >> (256 - 24) |
            uint256(UFixed6.unwrap(newValue.minLiquidationFee)                  << (256 - 48)) >> (256 - 24 - 48) |
            uint256(UFixed6.unwrap(newValue.maxLiquidationFee)                  << (256 - 48)) >> (256 - 24 - 48 - 48) |
            uint256(UFixed6.unwrap(newValue.utilizationCurve.minRate)           << (256 - 32)) >> (256 - 24 - 48 - 48 - 32) |
            uint256(UFixed6.unwrap(newValue.utilizationCurve.maxRate)           << (256 - 32)) >> (256 - 24 - 48 - 48 - 32 - 32) |
            uint256(UFixed6.unwrap(newValue.utilizationCurve.targetRate)        << (256 - 32)) >> (256 - 24 - 48 - 48 - 32 - 32 - 32) |
            uint256(UFixed6.unwrap(newValue.utilizationCurve.targetUtilization) << (256 - 24)) >> (256 - 24 - 48 - 48 - 32 - 32 - 32 - 24);

        uint256 encoded2 =
            uint256(UFixed6.unwrap(newValue.pController.k)                  << (256 - 48)) >> (256 - 48) |
            uint256(UFixed6.unwrap(newValue.pController.max)                << (256 - 32)) >> (256 - 48 - 32) |
            uint256(UFixed6.unwrap(newValue.minMaintenance)                 << (256 - 48)) >> (256 - 48 - 32 - 48) |
            uint256(UFixed6.unwrap(newValue.virtualTaker)                   << (256 - 64)) >> (256 - 48 - 32 - 48 - 64) |
            uint256(newValue.staleAfter                                     << (256 - 24)) >> (256 - 48 - 32 - 48 - 64 - 24) |
            uint256((newValue.makerReceiveOnly ? uint256(1) : uint256(0))   << (256 - 8))  >> (256 - 48 - 32 - 48 - 64 - 24 - 8);

        assembly {
            sstore(self.slot, encoded0)
            sstore(add(self.slot, 1), encoded1)
            sstore(add(self.slot, 2), encoded2)
        }
    }
}