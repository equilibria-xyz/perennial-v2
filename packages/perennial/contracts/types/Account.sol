// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "./Version.sol";
import "./Position.sol";

/// @dev Account type
struct Account {
    Fixed6 collateral;
    UFixed6 reward;
    bool liquidation;
}
using AccountLib for Account global;
struct StoredAccount {
    int64 _collateral;
    uint64 _reward;
    bool _liquidation;
    bytes15 __unallocated__;
}
struct AccountStorage { StoredAccount value; }
using AccountStorageLib for AccountStorage global;

/**
 * @title AccountLib
 * @notice Library that manages an account-level position.
 */
library AccountLib {
    function update(Account memory self, Fixed6 newCollateral) internal pure returns (Fixed6 collateralAmount) {
        collateralAmount = newCollateral.sub(self.collateral);
        self.collateral = newCollateral;
    }

    /**
     * @notice Settled the account's position to oracle version `toOracleVersion`
     * @param self The struct to operate on
     */
    function accumulate(
        Account memory self,
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
        Fixed6 feeAmount = Fixed6Lib.from(toPosition.fee.sub(fromPosition.fee));

        self.collateral = self.collateral.add(collateralAmount).sub(feeAmount);
        self.reward = self.reward.add(rewardAmount);
        self.liquidation = false; // TODO: not guaranteed to clear after one version in multi-delay
    }
}

library AccountStorageLib {
    error AccountStorageInvalidError();

    function read(AccountStorage storage self) internal view returns (Account memory) {
        StoredAccount memory storedValue =  self.value;

        return Account(
            Fixed6.wrap(int256(storedValue._collateral)),
            UFixed6.wrap(uint256(storedValue._reward)),
            bool(storedValue._liquidation)
        );
    }

    function store(AccountStorage storage self, Account memory newValue) internal {
        if (newValue.collateral.gt(Fixed6Lib.MAX_64)) revert AccountStorageInvalidError();
        if (newValue.reward.gt(UFixed6Lib.MAX_64)) revert AccountStorageInvalidError();

        self.value = StoredAccount(
            int64(Fixed6.unwrap(newValue.collateral)),
            uint64(UFixed6.unwrap(newValue.reward)),
            bool(newValue.liquidation),
            bytes15(0)
        );
    }
}