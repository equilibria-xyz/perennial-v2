// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { Fixed6 } from "@equilibria/root/number/types/Fixed6.sol";
import { UJumpRateUtilizationCurve6 } from "@equilibria/root/utilization/types/UJumpRateUtilizationCurve6.sol";
import { PController6 } from "@equilibria/root/pid/types/PController6.sol";
import { LinearAdiabatic6 } from "@equilibria/root/adiabatic/types/LinearAdiabatic6.sol";
import { NoopAdiabatic6 } from "@equilibria/root/adiabatic/types/NoopAdiabatic6.sol";
import { ProtocolParameter } from "./ProtocolParameter.sol";

/// @dev RiskParameter type
struct RiskParameter {
    /// @dev The minimum amount of collateral required to open a new position as a percentage of notional
    UFixed6 margin;

    /// @dev The minimum amount of collateral that must be maintained as a percentage of notional
    UFixed6 maintenance;

    /// @dev The taker impact fee
    LinearAdiabatic6 takerFee;

    /// @dev The maker fee configuration
    NoopAdiabatic6 makerFee;

    /// @dev The maximum amount of maker positions that opened
    UFixed6 makerLimit;

    /// @dev The minimum limit of the efficiency metric
    UFixed6 efficiencyLimit;

    /// @dev Multiple of the settlement fee charged when a position is liquidated
    UFixed6 liquidationFee;

    /// @dev The utilization curve that is used to compute maker interest
    UJumpRateUtilizationCurve6 utilizationCurve;

    /// @dev The p controller that is used to compute long-short funding
    PController6 pController;

    /// @dev The minimum fixed amount that is required to open a position
    UFixed6 minMargin;

    /// @dev The minimum fixed amount that is required for maintenance
    UFixed6 minMaintenance;

    /// @dev The maximum amount of time since the latest oracle version that update may still be called
    uint256 staleAfter;

    /// @dev Whether or not the maker should always receive positive funding
    bool makerReceiveOnly;
}
struct RiskParameterStorage { uint256 slot0; uint256 slot1; uint256 slot2; } // SECURITY: must remain at (3) slots
using RiskParameterStorageLib for RiskParameterStorage global;

/// @dev Manually encodes and decodes the local Position struct into storage.
///      (external-safe): this library is safe to externalize
///
///    struct StoredRiskParameter {
///        /* slot 0 */ (30)
///        uint24 margin;                              // <= 1677%
///        uint24 maintenance;                         // <= 1677%
///        uint24 takerLinearFee;                      // <= 1677%
///        uint24 takerProportionalFee;                // <= 1677%
///        uint24 takerAdiabaticFee;                   // <= 1677% (must maintain location due to updateRiskParameter)
///        uint24 makerLinearFee;                      // <= 1677%
///        uint24 makerProportionalFee;                // <= 1677%
///        uint48 makerLimit;                          // <= 281t (no decimals)
///        uint24 efficiencyLimit;                     // <= 1677%
///
///        /* slot 1 */ (31)
///        bytes3 __unallocated__;
///        uint48 makerSkewScale;                      // <= 281t (no decimals) (must maintain location due to updateRiskParameter)
///        uint48 takerSkewScale;                      // <= 281t (no decimals) (must maintain location due to updateRiskParameter)
///        uint24 utilizationCurveMinRate;             // <= 1677%
///        uint24 utilizationCurveMaxRate;             // <= 1677%
///        uint24 utilizationCurveTargetRate;          // <= 1677%
///        uint24 utilizationCurveTargetUtilization;   // <= 1677%
///        int32 pControllerMin;                       // <= 214748%
///
///        /* slot 2 */ (30)
///        uint48 pControllerK;                        // <= 281m
///        int32 pControllerMax;                       // <= 214748%
///        uint48 minMargin;                           // <= 281m
///        uint48 minMaintenance;                      // <= 281m
///        uint32 liquidationFee;                      // <= 4294
///        uint24 staleAfter;                          // <= 16m s
///        bool makerReceiveOnly;
///    }
library RiskParameterStorageLib {
    // sig: 0x7ecd083f
    error RiskParameterStorageInvalidError();

    function read(RiskParameterStorage storage self) internal view returns (RiskParameter memory) {
        (uint256 slot0, uint256 slot1, uint256 slot2) = (self.slot0, self.slot1, self.slot2);
        return RiskParameter(
            UFixed6.wrap(uint256(       slot0 << (256 - 24)) >> (256 - 24)),
            UFixed6.wrap(uint256(       slot0 << (256 - 24 - 24)) >> (256 - 24)),
            LinearAdiabatic6(
                UFixed6.wrap(uint256(   slot0 << (256 - 24 - 24 - 24)) >> (256 - 24)),
                UFixed6.wrap(uint256(   slot0 << (256 - 24 - 24 - 24 - 24)) >> (256 - 24)),
                UFixed6.wrap(uint256(   slot0 << (256 - 24 - 24 - 24 - 24 - 24)) >> (256 - 24)),
                UFixed6Lib.from(uint256(slot1 << (256 - 24 - 48 - 48)) >> (256 - 48))
            ),
            NoopAdiabatic6(
                UFixed6.wrap(uint256(   slot0 << (256 - 24 - 24 - 24 - 24 - 24 - 24)) >> (256 - 24)),
                UFixed6.wrap(uint256(   slot0 << (256 - 24 - 24 - 24 - 24 - 24 - 24 - 24)) >> (256 - 24)),
                UFixed6Lib.from(uint256(slot1 << (256 - 24 - 48)) >> (256 - 48))
            ),
            UFixed6Lib.from(uint256(    slot0 << (256 - 24 - 24 - 24 - 24 - 24 - 24 - 24 - 48)) >> (256 - 48)),
            UFixed6.wrap(uint256(       slot0 << (256 - 24 - 24 - 24 - 24 - 24 - 24 - 24 - 48 - 24)) >> (256 - 24)),

            UFixed6.wrap(uint256(       slot2 << (256 - 48 - 32 - 48 - 48 - 32)) >> (256 - 32)),
            UJumpRateUtilizationCurve6(
                UFixed6.wrap(uint256(   slot1 << (256 - 24 - 48 - 48 - 24)) >> (256 - 24)),
                UFixed6.wrap(uint256(   slot1 << (256 - 24 - 48 - 48 - 24 - 24)) >> (256 - 24)),
                UFixed6.wrap(uint256(   slot1 << (256 - 24 - 48 - 48 - 24 - 24 - 24)) >> (256 - 24)),
                UFixed6.wrap(uint256(   slot1 << (256 - 24 - 48 - 48 - 24 - 24 - 24 - 24)) >> (256 - 24))
            ),

            PController6(
                UFixed6.wrap(uint256(   slot2 << (256 - 48)) >> (256 - 48)),
                Fixed6.wrap(int256(     slot1 << (256 - 24 - 48 - 48 - 24 - 24 - 24 - 24 - 32)) >> (256 - 32)),
                Fixed6.wrap(int256(     slot2 << (256 - 48 - 32)) >> (256 - 32))
            ),
            UFixed6.wrap(uint256(       slot2 << (256 - 48 - 32 - 48)) >> (256 - 48)),
            UFixed6.wrap(uint256(       slot2 << (256 - 48 - 32 - 48 - 48)) >> (256 - 48)),
                         uint256(       slot2 << (256 - 48 - 32 - 48 - 48 - 32 - 24)) >> (256 - 24),
            0 !=        (uint256(       slot2 << (256 - 48 - 32 - 48 - 48 - 32 - 24 - 8)) >> (256 - 8))
        );
    }

    function validate(RiskParameter memory self, ProtocolParameter memory protocolParameter) private pure {
        if (
            self.takerFee.linearFee.max(self.takerFee.proportionalFee).max(self.takerFee.adiabaticFee)
                .max(self.makerFee.linearFee).max(self.makerFee.proportionalFee)
                .gt(protocolParameter.maxFee)
        ) revert RiskParameterStorageInvalidError();

        if (self.liquidationFee.gt(protocolParameter.maxLiquidationFee)) revert RiskParameterStorageInvalidError();

        if (
            self.utilizationCurve.minRate.max(self.utilizationCurve.maxRate).max(self.utilizationCurve.targetRate)
                .max(self.pController.max.abs()).max(self.pController.min.abs())
                .gt(protocolParameter.maxRate)
        ) revert RiskParameterStorageInvalidError();

        if (self.staleAfter > protocolParameter.maxStaleAfter) revert RiskParameterStorageInvalidError();

        if (self.maintenance.lt(protocolParameter.minMaintenance)) revert RiskParameterStorageInvalidError();
        if (self.maintenance.gt(UFixed6Lib.ONE)) revert RiskParameterStorageInvalidError();

        if (self.margin.lt(self.maintenance)) revert RiskParameterStorageInvalidError();
        if (self.margin.gt(UFixed6Lib.ONE)) revert RiskParameterStorageInvalidError();

        if (self.efficiencyLimit.lt(protocolParameter.minEfficiency)) revert RiskParameterStorageInvalidError();

        if (self.utilizationCurve.targetUtilization.gt(UFixed6Lib.ONE)) revert RiskParameterStorageInvalidError();

        if (self.minMargin.lt(self.minMaintenance)) revert RiskParameterStorageInvalidError();

        (UFixed6 makerLimitTruncated, UFixed6 takerFeeScaleTruncated, UFixed6 makerFeeScaleTruncated) = (
            UFixed6Lib.from(self.makerLimit.truncate()),
            UFixed6Lib.from(self.takerFee.scale.truncate()),
            UFixed6Lib.from(self.makerFee.scale.truncate())
        );
        UFixed6 scaleLimit = makerLimitTruncated.div(self.efficiencyLimit).mul(protocolParameter.minScale);
        if (takerFeeScaleTruncated.lt(scaleLimit) || makerFeeScaleTruncated.lt(scaleLimit))
            revert RiskParameterStorageInvalidError();
    }

    function validateAndStore(
        RiskParameterStorage storage self,
        RiskParameter memory newValue,
        ProtocolParameter memory protocolParameter
    ) external {
        validate(newValue, protocolParameter);

        if (newValue.margin.gt(UFixed6.wrap(type(uint24).max))) revert RiskParameterStorageInvalidError();
        if (newValue.minMargin.gt(UFixed6.wrap(type(uint48).max))) revert RiskParameterStorageInvalidError();
        if (newValue.efficiencyLimit.gt(UFixed6.wrap(type(uint24).max))) revert RiskParameterStorageInvalidError();
        if (newValue.makerLimit.gt(UFixed6Lib.from(type(uint48).max))) revert RiskParameterStorageInvalidError();
        if (newValue.pController.k.gt(UFixed6.wrap(type(uint48).max))) revert RiskParameterStorageInvalidError();
        if (newValue.takerFee.scale.gt(UFixed6Lib.from(type(uint48).max))) revert RiskParameterStorageInvalidError();
        if (newValue.makerFee.scale.gt(UFixed6Lib.from(type(uint48).max))) revert RiskParameterStorageInvalidError();
        if (newValue.staleAfter > uint256(type(uint24).max)) revert RiskParameterStorageInvalidError();

        uint256 encoded0 =
            uint256(UFixed6.unwrap(newValue.margin)                    << (256 - 24)) >> (256 - 24) |
            uint256(UFixed6.unwrap(newValue.maintenance)               << (256 - 24)) >> (256 - 24 - 24) |
            uint256(UFixed6.unwrap(newValue.takerFee.linearFee)        << (256 - 24)) >> (256 - 24 - 24 - 24) |
            uint256(UFixed6.unwrap(newValue.takerFee.proportionalFee)  << (256 - 24)) >> (256 - 24 - 24 - 24 - 24) |
            uint256(UFixed6.unwrap(newValue.takerFee.adiabaticFee)     << (256 - 24)) >> (256 - 24 - 24 - 24 - 24 - 24) |
            uint256(UFixed6.unwrap(newValue.makerFee.linearFee)        << (256 - 24)) >> (256 - 24 - 24 - 24 - 24 - 24 - 24) |
            uint256(UFixed6.unwrap(newValue.makerFee.proportionalFee)  << (256 - 24)) >> (256 - 24 - 24 - 24 - 24 - 24 - 24 - 24) |
            uint256(newValue.makerLimit.truncate()                     << (256 - 48)) >> (256 - 24 - 24 - 24 - 24 - 24 - 24 - 24 - 48) |
            uint256(UFixed6.unwrap(newValue.efficiencyLimit)           << (256 - 24)) >> (256 - 24 - 24 - 24 - 24 - 24 - 24 - 24 - 48 - 24);

        uint256 encoded1 =
            uint256(newValue.makerFee.scale.truncate()                          << (256 - 48)) >> (256 - 24 - 48) |
            uint256(newValue.takerFee.scale.truncate()                          << (256 - 48)) >> (256 - 24 - 48 - 48) |
            uint256(UFixed6.unwrap(newValue.utilizationCurve.minRate)           << (256 - 24)) >> (256 - 24 - 48 - 48 - 24) |
            uint256(UFixed6.unwrap(newValue.utilizationCurve.maxRate)           << (256 - 24)) >> (256 - 24 - 48 - 48 - 24 - 24) |
            uint256(UFixed6.unwrap(newValue.utilizationCurve.targetRate)        << (256 - 24)) >> (256 - 24 - 48 - 48 - 24 - 24 - 24) |
            uint256(UFixed6.unwrap(newValue.utilizationCurve.targetUtilization) << (256 - 24)) >> (256 - 24 - 48 - 48 - 24 - 24 - 24 - 24) |
            uint256(Fixed6.unwrap(newValue.pController.min)                     << (256 - 32)) >> (256 - 24 - 48 - 48 - 24 - 24 - 24 - 24 - 32);

        uint256 encoded2 =
            uint256(UFixed6.unwrap(newValue.pController.k)                  << (256 - 48)) >> (256 - 48) |
            uint256(Fixed6.unwrap(newValue.pController.max)                 << (256 - 32)) >> (256 - 48 - 32) |
            uint256(UFixed6.unwrap(newValue.minMargin)                      << (256 - 48)) >> (256 - 48 - 32 - 48) |
            uint256(UFixed6.unwrap(newValue.minMaintenance)                 << (256 - 48)) >> (256 - 48 - 32 - 48 - 48) |
            uint256(UFixed6.unwrap(newValue.liquidationFee)                 << (256 - 32)) >> (256 - 48 - 32 - 48 - 48 - 32) |
            uint256(newValue.staleAfter                                     << (256 - 24)) >> (256 - 48 - 32 - 48 - 48 - 32 - 24) |
            uint256((newValue.makerReceiveOnly ? uint256(1) : uint256(0))   << (256 - 8))  >> (256 - 48 - 32 - 48 - 48 - 32 - 24 - 8);

        assembly {
            sstore(self.slot, encoded0)
            sstore(add(self.slot, 1), encoded1)
            sstore(add(self.slot, 2), encoded2)
        }
    }
}