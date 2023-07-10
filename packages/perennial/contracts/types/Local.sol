// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "./Version.sol";
import "./Position.sol";

/// @dev Local type
struct Local {
    uint256 currentId;
    Fixed6 collateral;
    UFixed6 reward;
    uint256 protection;
}
using LocalLib for Local global;
struct StoredLocal {
    uint64 _currentId;
    int64 _collateral;
    uint64 _reward;
    uint64 _protection;
}
struct LocalStorage { uint256 value; }
using LocalStorageLib for LocalStorage global;

/**
 * @title LocalLib
 * @notice Library
 */
library LocalLib {
    function update(Local memory self, Fixed6 collateral) internal pure {
        self.collateral = self.collateral.add(collateral);
    }

    /**
     * @notice Settled the account's position to oracle version `toOracleVersion`
     * @param self The struct to operate on
     */
    function accumulate(
        Local memory self,
        Position memory fromPosition,
        Position memory toPosition,
        Version memory fromVersion,
        Version memory toVersion
    ) internal pure {
        Fixed6 collateralAmount = toVersion.makerValue.accumulated(fromVersion.makerValue, fromPosition.maker)
            .add(toVersion.longValue.accumulated(fromVersion.longValue, fromPosition.long))
            .add(toVersion.shortValue.accumulated(fromVersion.shortValue, fromPosition.short));
        UFixed6 rewardAmount = toVersion.makerReward.accumulated(fromVersion.makerReward, fromPosition.maker)
            .add(toVersion.longReward.accumulated(fromVersion.longReward, fromPosition.long))
            .add(toVersion.shortReward.accumulated(fromVersion.shortReward, fromPosition.short));
        Fixed6 feeAmount = Fixed6Lib.from(toPosition.fee.add(toPosition.keeper));

        self.collateral = self.collateral.add(collateralAmount).sub(feeAmount);
        self.reward = self.reward.add(rewardAmount);
    }

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

    function clearReward(Local memory self) internal pure {
        self.reward = UFixed6Lib.ZERO;
    }
}

library LocalStorageLib { // TODO (gas hint): automate this storage format to save contract size
    error LocalStorageInvalidError();

    function read(LocalStorage storage self) internal view returns (Local memory) {
        uint256 value = self.value;
        return Local(
            uint256(value << 192) >> 192,
            Fixed6.wrap(int256(value << 128) >> 192),
            UFixed6.wrap(uint256(value << 64) >> 192),
            uint256(value) >> 192
        );
    }

    function store(LocalStorage storage self, Local memory newValue) internal {
        if (newValue.currentId > uint256(type(uint64).max)) revert LocalStorageInvalidError();
        if (newValue.collateral.gt(Fixed6.wrap(type(int64).max))) revert LocalStorageInvalidError();
        if (newValue.collateral.lt(Fixed6.wrap(type(int64).min))) revert LocalStorageInvalidError();
        if (newValue.reward.gt(UFixed6.wrap(type(uint64).max))) revert LocalStorageInvalidError();
        if (newValue.protection > uint256(type(uint64).max)) revert LocalStorageInvalidError();

        uint256 encoded =
            uint256(newValue.currentId << 192) >> 192 |
            uint256(Fixed6.unwrap(newValue.collateral) << 192) >> 128 |
            uint256(UFixed6.unwrap(newValue.reward) << 192) >> 64 |
            uint256(newValue.protection << 192);
        assembly {
            sstore(self.slot, encoded)
        }
    }
}