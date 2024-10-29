// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { UFixed6 } from "@equilibria/root/number/types/UFixed6.sol";
import { Fixed6 } from "@equilibria/root/number/types/Fixed6.sol";
import { PAccumulator6 } from "@equilibria/root/pid/types/PAccumulator6.sol";
import { MarketParameter } from "./MarketParameter.sol";
import { RiskParameter } from "./RiskParameter.sol";
import { Position } from "./Position.sol";
import { OracleVersion } from "./OracleVersion.sol";
import { OracleReceipt } from "./OracleReceipt.sol";
import { VersionAccumulationResponse } from "../libs/VersionLib.sol";

/// @dev Global type
struct Global {
    /// @dev The current position ID
    uint256 currentId;

    /// @dev The latest position id
    uint256 latestId;

    /// @dev The accrued protocol fee
    UFixed6 protocolFee;

    /// @dev The accrued oracle fee
    UFixed6 oracleFee;

    /// @dev The accrued risk fee
    UFixed6 riskFee;

    /// @dev The latest valid price in the market
    Fixed6 latestPrice;

    /// @dev The accumulated market exposure
    Fixed6 exposure;

    /// @dev The current PAccumulator state
    PAccumulator6 pAccumulator;
}
using GlobalLib for Global global;
struct GlobalStorage { uint256 slot0; uint256 slot1; } // SECURITY: must remain at (2) slots
using GlobalStorageLib for GlobalStorage global;

/// @title Global
/// @dev (external-unsafe): this library must be used internally only
/// @notice Holds the global market state
library GlobalLib {
    /// @notice Updates market exposure based on a change in the risk parameter configuration
    /// @param self The Global object to update
    /// @param latestRiskParameter The latest risk parameter configuration
    /// @param newRiskParameter The new risk parameter configuration
    /// @param latestPosition The latest position
    function update(
        Global memory self,
        RiskParameter memory latestRiskParameter,
        RiskParameter memory newRiskParameter,
        Position memory latestPosition
    ) internal pure {
        Fixed6 exposureChange = latestRiskParameter.takerFee
            .exposure(newRiskParameter.takerFee, latestPosition.skew(), self.latestPrice.abs());
        self.exposure = self.exposure.sub(exposureChange);
    }

    /// @notice Increments the fees by `amount` using current parameters
    /// @dev Computes the fees based on the current market parameters
    ///      market fee -> trade fee + market's trade offset + funding fee + interest fee
    ///        1. oracle fee taken out as a percentage of what's left of market fee
    ///        2. risk fee taken out as a percentage of what's left of market fee
    ///        3. protocol fee is what's left of market fee
    /// @param self The Global object to update
    /// @param newLatestId The new latest position id
    /// @param accumulation The accumulation result
    /// @param marketParameter The current market parameters
    /// @param oracleReceipt The receipt of the corresponding oracle version
    function update(
        Global memory self,
        uint256 newLatestId,
        VersionAccumulationResponse memory accumulation,
        MarketParameter memory marketParameter,
        OracleReceipt memory oracleReceipt
    ) internal pure {
        UFixed6 marketFee = accumulation.marketFee;

        UFixed6 oracleFee = marketFee.mul(oracleReceipt.oracleFee);
        marketFee = marketFee.sub(oracleFee);

        UFixed6 riskFee = marketFee.mul(marketParameter.riskFee);
        marketFee = marketFee.sub(riskFee);

        self.latestId = newLatestId;
        self.protocolFee = self.protocolFee.add(marketFee);
        self.oracleFee = self.oracleFee.add(accumulation.settlementFee).add(oracleFee);
        self.riskFee = self.riskFee.add(riskFee);
        self.exposure = self.exposure.add(accumulation.marketExposure);
    }

    /// @notice Overrides the price of the oracle with the latest global version if it is empty
    /// @param self The Global object to read from
    /// @param oracleVersion The oracle version to update
    function overrideIfZero(Global memory self, OracleVersion memory oracleVersion) internal pure {
        if (oracleVersion.price.isZero()) oracleVersion.price = self.latestPrice;
    }
}

/// @dev Manually encodes and decodes the Global struct into storage.
///      (external-safe): this library is safe to externalize
///
///     struct StoredGlobal {
///         /* slot 0 */
///         uint32 currentId;           // <= 4.29b
///         uint32 latestId;            // <= 4.29b
///         uint48 protocolFee;         // <= 281m
///         uint48 oracleFee;           // <= 281m
///         uint48 riskFee;             // <= 281m
///
///         /* slot 1 */
///         int32 pAccumulator.value;   // <= 214000%
///         int24 pAccumulator.skew;    // <= 838%
///         int64 latestPrice;          // <= 9.22t
///         int64 exposure;             // <= 9.22t
///     }
///
library GlobalStorageLib {
    // sig: 0x2142bc27
    error GlobalStorageInvalidError();

    function read(GlobalStorage storage self) internal view returns (Global memory) {
        (uint256 slot0, uint256 slot1) = (self.slot0, self.slot1);
        return Global(
            uint256(slot0 << (256 - 32)) >> (256 - 32),
            uint256(slot0 << (256 - 32 - 32)) >> (256 - 32),
            UFixed6.wrap(uint256(slot0 << (256 - 32 - 32 - 48)) >> (256 - 48)),
            UFixed6.wrap(uint256(slot0 << (256 - 32 - 32 - 48 - 48)) >> (256 - 48)),
            UFixed6.wrap(uint256(slot0 << (256 - 32 - 32 - 48 - 48 - 48)) >> (256 - 48)),
            Fixed6.wrap(int256(slot1 << (256 - 32 - 24 - 64)) >> (256 - 64)),
            Fixed6.wrap(int256(slot1 << (256 - 32 - 24 - 64 - 64)) >> (256 - 64)),
            PAccumulator6(
                Fixed6.wrap(int256(slot1 << (256 - 32)) >> (256 - 32)),
                Fixed6.wrap(int256(slot1 << (256 - 32 - 24)) >> (256 - 24))
            )
        );
    }

    function store(GlobalStorage storage self, Global memory newValue) external {
        if (newValue.currentId > uint256(type(uint32).max)) revert GlobalStorageInvalidError();
        if (newValue.latestId > uint256(type(uint32).max)) revert GlobalStorageInvalidError();
        if (newValue.protocolFee.gt(UFixed6.wrap(type(uint48).max))) revert GlobalStorageInvalidError();
        if (newValue.oracleFee.gt(UFixed6.wrap(type(uint48).max))) revert GlobalStorageInvalidError();
        if (newValue.riskFee.gt(UFixed6.wrap(type(uint48).max))) revert GlobalStorageInvalidError();
        if (newValue.latestPrice.gt(Fixed6.wrap(type(int64).max))) revert GlobalStorageInvalidError();
        if (newValue.latestPrice.lt(Fixed6.wrap(type(int64).min))) revert GlobalStorageInvalidError();
        if (newValue.exposure.gt(Fixed6.wrap(type(int64).max))) revert GlobalStorageInvalidError();
        if (newValue.exposure.lt(Fixed6.wrap(type(int64).min))) revert GlobalStorageInvalidError();
        if (newValue.pAccumulator._value.gt(Fixed6.wrap(type(int32).max))) revert GlobalStorageInvalidError();
        if (newValue.pAccumulator._value.lt(Fixed6.wrap(type(int32).min))) revert GlobalStorageInvalidError();
        if (newValue.pAccumulator._skew.gt(Fixed6.wrap(type(int24).max))) revert GlobalStorageInvalidError();
        if (newValue.pAccumulator._skew.lt(Fixed6.wrap(type(int24).min))) revert GlobalStorageInvalidError();

        uint256 encoded0 =
            uint256(newValue.currentId << (256 - 32)) >> (256 - 32) |
            uint256(newValue.latestId << (256 - 32)) >> (256 - 32 - 32) |
            uint256(UFixed6.unwrap(newValue.protocolFee) << (256 - 48)) >> (256 - 32 - 32 - 48) |
            uint256(UFixed6.unwrap(newValue.oracleFee) << (256 - 48)) >> (256 - 32 - 32 - 48 - 48) |
            uint256(UFixed6.unwrap(newValue.riskFee) << (256 - 48)) >> (256 - 32 - 32 - 48 - 48 - 48);

        uint256 encoded1 =
            uint256(Fixed6.unwrap(newValue.pAccumulator._value) << (256 - 32)) >> (256 - 32) |
            uint256(Fixed6.unwrap(newValue.pAccumulator._skew) << (256 - 24)) >> (256 - 32 - 24) |
            uint256(Fixed6.unwrap(newValue.latestPrice) << (256 - 64)) >> (256 - 32 - 24 - 64) |
            uint256(Fixed6.unwrap(newValue.exposure) << (256 - 64)) >> (256 - 32 - 24 - 64 - 64);

        assembly {
            sstore(self.slot, encoded0)
            sstore(add(self.slot, 1), encoded1)
        }
    }
}
