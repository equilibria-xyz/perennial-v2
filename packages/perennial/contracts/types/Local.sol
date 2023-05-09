// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "./Version.sol";
import "./Position.sol";

/// @dev Local type
struct Local {
    uint256 currentId;
    Fixed6 collateral;
    UFixed6 reward;
    uint256 liquidation;
}
using LocalLib for Local global;
struct StoredLocal {
    uint64 _currentId;
    int64 _collateral;
    uint64 _reward;
    uint64 _liquidation;
}
struct LocalStorage { StoredLocal value; }
using LocalStorageLib for LocalStorage global;

/**
 * @title LocalLib
 * @notice Library
 */
library LocalLib {
    function update(Local memory self, Fixed6 newCollateral) internal pure returns (Fixed6 collateralAmount) {
        collateralAmount = newCollateral.sub(self.collateral);
        self.collateral = newCollateral;
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
        Fixed6 feeAmount = Fixed6Lib.from(toPosition.fee);

        self.collateral = self.collateral.add(collateralAmount).sub(feeAmount);
        self.reward = self.reward.add(rewardAmount);
    }

    function clearReward(Local memory self) internal pure {
        self.reward = UFixed6Lib.ZERO;
    }
}

library LocalStorageLib {
    error LocalStorageInvalidError();

    function read(LocalStorage storage self) internal view returns (Local memory) {
        StoredLocal memory storedValue =  self.value;

        return Local(
            uint256(storedValue._currentId),
            Fixed6.wrap(int256(storedValue._collateral)),
            UFixed6.wrap(uint256(storedValue._reward)),
            uint256(storedValue._liquidation)
        );
    }

    function store(LocalStorage storage self, Local memory newValue) internal {
        if (newValue.currentId > type(uint64).max) revert LocalStorageInvalidError();
        if (newValue.collateral.gt(Fixed6Lib.MAX_64)) revert LocalStorageInvalidError();
        if (newValue.reward.gt(UFixed6Lib.MAX_64)) revert LocalStorageInvalidError();
        if (newValue.liquidation > type(uint64).max) revert LocalStorageInvalidError();

        self.value = StoredLocal(
            uint64(newValue.currentId),
            int64(Fixed6.unwrap(newValue.collateral)),
            uint64(UFixed6.unwrap(newValue.reward)),
            uint64(newValue.liquidation)
        );
    }
}