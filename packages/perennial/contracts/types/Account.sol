// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "./Version.sol";
import "./Order.sol";

/// @dev Account type
struct Account {
    Order order;
    Fixed6 collateral;
    UFixed6 reward;
    bool liquidation;
}
using AccountLib for Account global;
struct StoredAccount {
    uint8 _positionMask;
    uint32 _version;                // <= 4.29b
    uint72 _position;               // <= 4.7e21
    int72 _collateral;              // <= 2.4e21
    uint72 _liquidationAndReward;   // <= 2.4e21
}
struct AccountStorage { StoredAccount value; }
using AccountStorageLib for AccountStorage global;

/**
 * @title AccountLib
 * @notice Library that manages an account-level position.
 */
library AccountLib {
    function update(
        Account memory self,
        Fixed6 newCollateral,
        UFixed6 positionFee
    ) internal pure returns (Fixed6 collateralAmount) {
        collateralAmount = newCollateral.sub(self.collateral).add(Fixed6Lib.from(positionFee));
        self.collateral = newCollateral;
    }

    /**
     * @notice Settled the account's position to oracle version `toOracleVersion`
     * @param self The struct to operate on
     */
    function accumulate(
        Account memory self,
        Order memory order,
        Version memory fromVersion,
        Version memory toVersion
    ) internal pure {
        Fixed6 collateralAmount = toVersion.makerValue.accumulated(fromVersion.makerValue, self.order.maker)
            .add(toVersion.longValue.accumulated(fromVersion.longValue, self.order.long))
            .add(toVersion.shortValue.accumulated(fromVersion.shortValue, self.order.short));
        UFixed6 rewardAmount = toVersion.makerReward.accumulated(fromVersion.makerReward, self.order.maker)
            .add(toVersion.longReward.accumulated(fromVersion.longReward, self.order.long))
            .add(toVersion.shortReward.accumulated(fromVersion.shortReward, self.order.short));

        self.order.version = order.version;
        self.order.maker = order.maker;
        self.order.long = order.long;
        self.order.short = order.short;
        self.collateral = self.collateral.add(collateralAmount);
        self.reward = self.reward.add(rewardAmount);
        self.liquidation = false;
    }

    /**
     * @notice Returns the current maintenance requirement for the account
     * @dev Must be called from a valid product to get the proper maintenance value
     * @param self The struct to operate on
     * @return Current maintenance requirement for the account
     */
    function maintenance(
        Account memory self,
        OracleVersion memory currentOracleVersion,
        UFixed6 maintenanceRatio
    ) internal pure returns (UFixed6) {
        return maintenance(self.order, currentOracleVersion, maintenanceRatio);
    }

    /**
     * @notice Returns the maintenance requirement for a specific order
     * @dev Assumes no price change
     * @param order The order to operate on
     * @return Next maintenance requirement for the account
     */
    function maintenance(
        Order memory order,
        OracleVersion memory currentOracleVersion,
        UFixed6 maintenanceRatio
    ) internal pure returns (UFixed6) {
        return order.position().mul(currentOracleVersion.price.abs()).mul(maintenanceRatio);
    }
}

library AccountStorageLib {
    error AccountStorageInvalidError();

    uint64 constant REWARD_AND_LIQUIDATION_SIZE = 72;
    uint64 constant LIQUIDATION_MASK = uint64(1 << (REWARD_AND_LIQUIDATION_SIZE - 1));

    function read(AccountStorage storage self) internal view returns (Account memory) {
        StoredAccount memory storedValue =  self.value;

        bool isMaker = storedValue._positionMask & uint256(1) != 0;
        bool isLong = storedValue._positionMask & uint256(1 << 1) != 0;
        bool isShort = storedValue._positionMask & uint256(1 << 2) != 0;

        return Account(
            Order(
                uint256(storedValue._version),
                UFixed6.wrap(uint256(isMaker ? storedValue._position : 0)),
                UFixed6.wrap(uint256(isLong ? storedValue._position : 0)),
                UFixed6.wrap(uint256(isShort ? storedValue._position : 0))
            ),
            Fixed6.wrap(int256(storedValue._collateral)),
            UFixed6.wrap(uint256(storedValue._liquidationAndReward & ~LIQUIDATION_MASK)),
            bool(storedValue._liquidationAndReward & LIQUIDATION_MASK != 0)
        );
    }

    function store(AccountStorage storage self, Account memory newValue) internal {
        if (newValue.order.version > type(uint32).max) revert AccountStorageInvalidError();
        if (newValue.order.position().gt(UFixed6Lib.MAX_72)) revert AccountStorageInvalidError();
        if (newValue.collateral.gt(Fixed6Lib.MAX_72)) revert AccountStorageInvalidError();
        if (newValue.reward.gt(UFixed6.wrap((1 << (REWARD_AND_LIQUIDATION_SIZE - 1)) - 1))) revert AccountStorageInvalidError();

        uint256 _positionMask =
            ((newValue.order.maker.isZero() ? 0 : 1)) |
            ((newValue.order.long.isZero() ? 0 : 1) << 1) |
            ((newValue.order.short.isZero() ? 0 : 1) << 2);

        self.value = StoredAccount(
            uint8(_positionMask),
            uint32(newValue.order.version),
            uint72(UFixed6.unwrap(newValue.order.position())),
            int72(Fixed6.unwrap(newValue.collateral)),
            uint72((UFixed6.unwrap(newValue.reward)) | (uint72(newValue.liquidation ? 1 : 0) << (REWARD_AND_LIQUIDATION_SIZE - 1)))
        );
    }
}