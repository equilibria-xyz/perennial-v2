// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/pid/types/PAccumulator6.sol";
import "./ProtocolParameter.sol";
import "./MarketParameter.sol";

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

    /// @dev The accrued donation
    UFixed6 donation;

    /// @dev The current PAccumulator state
    PAccumulator6 pAccumulator;

    /// @dev The latest valid price
    Fixed6 latestPrice;
}
using GlobalLib for Global global;
struct GlobalStorage { uint256 slot0; uint256 slot1; }
using GlobalStorageLib for GlobalStorage global;

/// @title Global
/// @notice Holds the global market state
library GlobalLib {
    /// @notice Increments the fees by `amount` using current parameters
    /// @param self The Global object to update
    /// @param amount The amount to increment fees by
    /// @param keeper The amount to increment the keeper fee by
    /// @param marketParameter The current market parameters
    /// @param protocolParameter The current protocol parameters
    function incrementFees(
        Global memory self,
        UFixed6 amount,
        UFixed6 keeper,
        MarketParameter memory marketParameter,
        ProtocolParameter memory protocolParameter
    ) internal pure {
        UFixed6 protocolFeeAmount = amount.mul(protocolParameter.protocolFee);
        UFixed6 marketFeeAmount = amount.sub(protocolFeeAmount);

        UFixed6 oracleFeeAmount = marketFeeAmount.mul(marketParameter.oracleFee);
        UFixed6 riskFeeAmount = marketFeeAmount.mul(marketParameter.riskFee);
        UFixed6 donationAmount = marketFeeAmount.sub(oracleFeeAmount).sub(riskFeeAmount);

        self.protocolFee = self.protocolFee.add(protocolFeeAmount);
        self.oracleFee = self.oracleFee.add(keeper).add(oracleFeeAmount);
        self.riskFee = self.riskFee.add(riskFeeAmount);
        self.donation = self.donation.add(donationAmount);
    }

    /// @notice Updates the latest valid price
    /// @param self The Global object to update
    /// @param latestPrice The new latest valid price
    function update(Global memory self, uint256 latestId, Fixed6 latestPrice) internal pure {
        self.latestId = latestId;
        self.latestPrice = latestPrice;
    }
}

/// @dev Manually encodes and decodes the Global struct into storage.
///
///     struct StoredGlobal {
///         /* slot 0 */
///         uint32 currentId;           // <= 4.29b
///         uint32 latestId;            // <= 4.29b
///         uint48 protocolFee;         // <= 281m
///         uint48 oracleFee;           // <= 281m
///         uint48 riskFee;             // <= 281m
///         uint48 donation;            // <= 281m
///
///         /* slot 1 */
///         int32 pAccumulator.value;   // <= 214000%
///         int24 pAccumulator.skew;    // <= 838%
///         int64 latestPrice;          // <= 9.22t
///     }
///
library GlobalStorageLib {
    error GlobalStorageInvalidError();

    function read(GlobalStorage storage self) internal view returns (Global memory) {
        (uint256 slot0, uint256 slot1) = (self.slot0, self.slot1);
        return Global(
            uint256(slot0 << (256 - 32)) >> (256 - 32),
            uint256(slot0 << (256 - 32 - 32)) >> (256 - 32),
            UFixed6.wrap(uint256(slot0 << (256 - 32 - 32 - 48)) >> (256 - 48)),
            UFixed6.wrap(uint256(slot0 << (256 - 32 - 32 - 48 - 48)) >> (256 - 48)),
            UFixed6.wrap(uint256(slot0 << (256 - 32 - 32 - 48 - 48 - 48)) >> (256 - 48)),
            UFixed6.wrap(uint256(slot0 << (256 - 32 - 32 - 48 - 48 - 48 - 48)) >> (256 - 48)),
            PAccumulator6(
                Fixed6.wrap(int256(slot1 << (256 - 32)) >> (256 - 32)),
                Fixed6.wrap(int256(slot1 << (256 - 32 - 24)) >> (256 - 24))
            ),
            Fixed6.wrap(int256(slot1 << (256 - 32 - 24 - 64)) >> (256 - 64))
        );
    }

    function store(GlobalStorage storage self, Global memory newValue) internal {
        if (newValue.currentId > uint256(type(uint32).max)) revert GlobalStorageInvalidError();
        if (newValue.latestId > uint256(type(uint32).max)) revert GlobalStorageInvalidError();
        if (newValue.protocolFee.gt(UFixed6.wrap(type(uint48).max))) revert GlobalStorageInvalidError();
        if (newValue.oracleFee.gt(UFixed6.wrap(type(uint48).max))) revert GlobalStorageInvalidError();
        if (newValue.riskFee.gt(UFixed6.wrap(type(uint48).max))) revert GlobalStorageInvalidError();
        if (newValue.donation.gt(UFixed6.wrap(type(uint48).max))) revert GlobalStorageInvalidError();
        if (newValue.pAccumulator._value.gt(Fixed6.wrap(type(int32).max))) revert GlobalStorageInvalidError();
        if (newValue.pAccumulator._value.lt(Fixed6.wrap(type(int32).min))) revert GlobalStorageInvalidError();
        if (newValue.pAccumulator._skew.gt(Fixed6.wrap(type(int24).max))) revert GlobalStorageInvalidError();
        if (newValue.pAccumulator._skew.lt(Fixed6.wrap(type(int24).min))) revert GlobalStorageInvalidError();
        if (newValue.latestPrice.gt(Fixed6.wrap(type(int64).max))) revert GlobalStorageInvalidError();
        if (newValue.latestPrice.lt(Fixed6.wrap(type(int64).min))) revert GlobalStorageInvalidError();

        uint256 encoded0 =
            uint256(newValue.currentId << (256 - 32)) >> (256 - 32) |
            uint256(newValue.latestId << (256 - 32)) >> (256 - 32 - 32) |
            uint256(UFixed6.unwrap(newValue.protocolFee) << (256 - 48)) >> (256 - 32 - 32 - 48) |
            uint256(UFixed6.unwrap(newValue.oracleFee) << (256 - 48)) >> (256 - 32 - 32 - 48 - 48) |
            uint256(UFixed6.unwrap(newValue.riskFee) << (256 - 48)) >> (256 - 32 - 32 - 48 - 48 - 48) |
            uint256(UFixed6.unwrap(newValue.donation) << (256 - 48)) >> (256 - 32 - 32 - 48 - 48 - 48 - 48);

        uint256 encoded1 =
            uint256(Fixed6.unwrap(newValue.pAccumulator._value) << (256 - 32)) >> (256 - 32) |
            uint256(Fixed6.unwrap(newValue.pAccumulator._skew) << (256 - 24)) >> (256 - 32 - 24) |
            uint256(Fixed6.unwrap(newValue.latestPrice) << (256 - 64)) >> (256 - 32 - 24 - 64);

        assembly {
            sstore(self.slot, encoded0)
            sstore(add(self.slot, 1), encoded1)
        }
    }
}
