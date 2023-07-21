// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/UFixed6.sol";
import "@equilibria/root/curve/types/UJumpRateUtilizationCurve6.sol";
import "@equilibria/root-v2/contracts/PController6.sol";
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
    uint48 virtualTaker;                        // <= 281mn

    /* slot 3 */
    uint24 liquidationFee;                      // <= 1677%
    uint48 minLiquidationFee;                   // <= 281mn
    uint48 maxLiquidationFee;                   // <= 281mn
    uint24 efficiencyLimit;                     // <= 1677%
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
            UFixed6.wrap(uint256(value.efficiencyLimit)),
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
            UFixed6.wrap(uint256(value.virtualTaker)),
            uint256(value.staleAfter),
            value.makerReceiveOnly
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
        if (newValue.pController.k.gt(UFixed6.wrap(type(uint40).max))) revert RiskParameterStorageInvalidError();
        if (newValue.virtualTaker.gt(UFixed6.wrap(type(uint48).max))) revert RiskParameterStorageInvalidError();
        if (newValue.staleAfter > uint256(type(uint24).max)) revert RiskParameterStorageInvalidError();

        self.value = StoredRiskParameter({
            maintenance: uint24(UFixed6.unwrap(newValue.maintenance)),
            takerFee: uint24(UFixed6.unwrap(newValue.takerFee)),
            takerSkewFee: uint24(UFixed6.unwrap(newValue.takerSkewFee)),
            takerImpactFee: uint24(UFixed6.unwrap(newValue.takerImpactFee)),
            makerFee: uint24(UFixed6.unwrap(newValue.makerFee)),
            makerImpactFee: uint24(UFixed6.unwrap(newValue.makerImpactFee)),
            makerLimit: uint48(UFixed6.unwrap(newValue.makerLimit)),
            efficiencyLimit: uint24(UFixed6.unwrap(newValue.efficiencyLimit)),
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
            virtualTaker: uint48(UFixed6.unwrap(newValue.virtualTaker)),
            staleAfter: uint24(newValue.staleAfter),
            makerReceiveOnly: newValue.makerReceiveOnly
        });
    }
}