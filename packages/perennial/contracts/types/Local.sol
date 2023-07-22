// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/Fixed6.sol";
import "./Version.sol";
import "./Position.sol";

/// @dev Local type
struct Local {
    /// @dev The current position id
    uint256 currentId;

    /// @dev The latest position id
    uint256 latestId;

    /// @dev The collateral balance
    Fixed6 collateral;

    /// @dev The reward balance
    UFixed6 reward;

    /// @dev The protection status
    uint256 protection;
}
using LocalLib for Local global;
struct LocalStorage { uint256 slot0; }
using LocalStorageLib for LocalStorage global;

struct LocalAccumulationResult {
    Fixed6 collateralAmount;
    UFixed6 rewardAmount;
    UFixed6 positionFee;
    UFixed6 keeper;
}

/// @title Local
/// @notice Holds the local account state
library LocalLib {
    /// @notice Updates the collateral with the new collateral change
    /// @param self The Local object to update
    /// @param collateral The amount to update the collateral by
    function update(Local memory self, Fixed6 collateral) internal pure {
        self.collateral = self.collateral.add(collateral);
    }

    /// @notice Settled the local from its latest position to next position
    /// @param self The Local object to update
    /// @param fromPosition The previous latest position
    /// @param toPosition The next latest position
    /// @param fromVersion The previous latest version
    /// @param toVersion The next latest version
    /// @return values The accumulation result
    function accumulate(
        Local memory self,
        uint256 latestId,
        Position memory fromPosition,
        Position memory toPosition,
        Version memory fromVersion,
        Version memory toVersion
    ) internal pure returns (LocalAccumulationResult memory values) {
        values.collateralAmount = toVersion.makerValue.accumulated(fromVersion.makerValue, fromPosition.maker)
            .add(toVersion.longValue.accumulated(fromVersion.longValue, fromPosition.long))
            .add(toVersion.shortValue.accumulated(fromVersion.shortValue, fromPosition.short));
        values.rewardAmount = toVersion.makerReward.accumulated(fromVersion.makerReward, fromPosition.maker)
            .add(toVersion.longReward.accumulated(fromVersion.longReward, fromPosition.long))
            .add(toVersion.shortReward.accumulated(fromVersion.shortReward, fromPosition.short));
        values.positionFee = toPosition.fee;
        values.keeper = toPosition.keeper;

        Fixed6 feeAmount = Fixed6Lib.from(values.positionFee.add(values.keeper));
        self.collateral = self.collateral.add(values.collateralAmount).sub(feeAmount);
        self.reward = self.reward.add(values.rewardAmount);
        self.latestId = latestId;
    }

    /// @notice Updates the local to put it into a protected state for liquidation
    /// @param self The Local object to update
    /// @param latestPosition The latest position
    /// @param currentTimestamp The current timestamp
    /// @param tryProtect Whether to try to protect the local
    /// @return Whether the local was protected
    function protect(
        Local memory self,
        Position memory latestPosition,
        uint256 currentTimestamp,
        bool tryProtect
    ) internal pure returns (bool) {
        if (!tryProtect || self.protection > latestPosition.timestamp) return false;
        self.protection = currentTimestamp;
        return true;
    }

    /// @notice Clears the local's reward value
    /// @param self The Local object to update
    function clearReward(Local memory self) internal pure {
        self.reward = UFixed6Lib.ZERO;
    }
}

/// @dev Manually encodes and decodes the Local struct into storage.
///
///     struct StoredLocal {
///         /* slot 0 */
///         uint32 currentId;   // <= 4.29b
///         uint32 latestId;    // <= 4.29b
///         int64 collateral;   // <= 9.22t
///         uint64 reward;      // <= 18.44t
///         uint64 protection;  // <= 18.44t
///     }
///
library LocalStorageLib {
    error LocalStorageInvalidError();

    function read(LocalStorage storage self) internal view returns (Local memory) {
        uint256 slot0 = self.slot0;
        return Local(
            uint256(slot0 << (256 - 32)) >> (256 - 32),
            uint256(slot0 << (256 - 32 - 32)) >> (256 - 32),
            Fixed6.wrap(int256(slot0 << (256 - 32 - 32 - 64)) >> (256 - 64)),
            UFixed6.wrap(uint256(slot0 << (256 - 32 - 32 - 64 - 64)) >> (256 - 64)),
            (uint256(slot0) << (256 - 32 - 32 - 64 - 64 - 64)) >> (256 - 64)
        );
    }

    function store(LocalStorage storage self, Local memory newValue) internal {
        if (newValue.currentId > uint256(type(uint32).max)) revert LocalStorageInvalidError();
        if (newValue.latestId > uint256(type(uint32).max)) revert LocalStorageInvalidError();
        if (newValue.collateral.gt(Fixed6.wrap(type(int64).max))) revert LocalStorageInvalidError();
        if (newValue.collateral.lt(Fixed6.wrap(type(int64).min))) revert LocalStorageInvalidError();
        if (newValue.reward.gt(UFixed6.wrap(type(uint64).max))) revert LocalStorageInvalidError();
        if (newValue.protection > uint256(type(uint64).max)) revert LocalStorageInvalidError();

        uint256 encoded =
            uint256(newValue.currentId << (256 - 32)) >> (256 - 32) |
            uint256(newValue.latestId << (256 - 32)) >> (256 - 32 - 32) |
            uint256(Fixed6.unwrap(newValue.collateral) << (256 - 64)) >> (256 - 32 - 32 - 64) |
            uint256(UFixed6.unwrap(newValue.reward) << (256 - 64)) >> (256 - 32 - 32 - 64 - 64) |
            uint256(newValue.protection << (256 - 64)) >> (256 - 32 - 32 - 64 - 64 - 64);
        assembly {
            sstore(self.slot, encoded)
        }
    }
}