// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "./Version.sol";

/// @dev Account type
struct Account {
    uint256 latestVersion;
    UFixed6 maker;
    UFixed6 taker;
    UFixed6 nextMaker;
    UFixed6 nextTaker;
    Fixed6 collateral;
    UFixed6 reward;
    bool liquidation;
}
using AccountLib for Account global;
struct StoredAccount {
    uint8 _positionMask;
    uint24 _latestVersion;          // <= 4.29b
    uint56 _position;                // <= 36b
    uint56 _next;                    // <= 36b
    int56 _collateral;              // <= 36b
    uint56 _liquidationAndReward;   // <= 36b
}
struct AccountStorage { StoredAccount value; }
using AccountStorageLib for AccountStorage global;

/**
 * @title AccountLib
 * @notice Library that manages an account-level position.
 */
library AccountLib {
    function position(Account memory self) internal pure returns (UFixed6) {
        return self.maker.add(self.taker);
    }

    function next(Account memory self) internal pure returns (UFixed6) {
        return self.nextMaker.add(self.nextTaker);
    }

    function update(
        Account memory self,
        UFixed6 newMaker,
        UFixed6 newTaker,
        Fixed6 newCollateral,
        OracleVersion memory currentOracleVersion,
        MarketParameter memory marketParameter
    ) internal pure returns (
        Fixed6 makerAmount,
        Fixed6 takerAmount,
        UFixed6 takerFee,
        Fixed6 collateralAmount
    ) {
        // compute
        (makerAmount, takerAmount) = (
            Fixed6Lib.from(newMaker).sub(Fixed6Lib.from(self.nextMaker)),
            Fixed6Lib.from(newTaker).sub(Fixed6Lib.from(self.nextTaker))
        );
        takerFee = takerAmount.mul(currentOracleVersion.price).abs().mul(marketParameter.takerFee);
        collateralAmount = newCollateral.sub(self.collateral).sub(Fixed6Lib.from(takerFee));

        // update
        self.nextMaker = newMaker;
        self.nextTaker = newTaker;
        self.collateral = newCollateral;
    }

    /**
     * @notice Settled the account's position to oracle version `toOracleVersion`
     * @param self The struct to operate on
     */
    function accumulate(
        Account memory self,
        OracleVersion memory toOracleVersion,
        Version memory fromVersion,
        Version memory toVersion
    ) internal pure {
        Fixed6 collateralAmount = Fixed6Lib.from(self.maker).mul(toVersion.makerValue.accumulated(fromVersion.makerValue))
            .add(Fixed6Lib.from(self.taker).mul(toVersion.takerValue.accumulated(fromVersion.takerValue)));
        UFixed6 rewardAmount = self.maker.mul(toVersion.makerReward.accumulated(fromVersion.makerReward))
            .add(self.taker.mul(toVersion.takerReward.accumulated(fromVersion.takerReward)));

        self.latestVersion = toOracleVersion.version;
        self.maker = self.nextMaker;
        self.taker = self.nextTaker;
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
        return _maintenance(position(self), currentOracleVersion, maintenanceRatio);
    }

    /**
     * @notice Returns the maintenance requirement after the next oracle version settlement
     * @dev Includes the current pending-settlement position delta, assumes no price change
     * @param self The struct to operate on
     * @return Next maintenance requirement for the account
     */
    function maintenanceNext(
        Account memory self,
        OracleVersion memory currentOracleVersion,
        UFixed6 maintenanceRatio
    ) internal pure returns (UFixed6) {
        return _maintenance(next(self), currentOracleVersion, maintenanceRatio);
    }

    /**
     * @notice Returns the maintenance requirement for a given `position`
     * @dev Internal helper
     * @param _position The position to compete the maintenance requirement for
     * @return Next maintenance requirement for the account
     */
    function _maintenance(
        UFixed6 _position,
        OracleVersion memory currentOracleVersion,
        UFixed6 maintenanceRatio
    ) private pure returns (UFixed6) {
        return _position.mul(currentOracleVersion.price.abs()).mul(maintenanceRatio);
    }
}

library AccountStorageLib {
    error AccountStorageInvalidError();
    error AccountStorageDoubleSidedError();

    uint64 constant LIQUIDATION_MASK = uint64(1 << 55);

    function read(AccountStorage storage self) internal view returns (Account memory) {
        StoredAccount memory storedValue =  self.value;

        bool isMaker = storedValue._positionMask & uint256(1) != 0;
        bool isTaker = storedValue._positionMask & uint256(1 << 1) != 0;
        bool isNextMaker = storedValue._positionMask & uint256(1 << 2) != 0;
        bool isNextTaker = storedValue._positionMask & uint256(1 << 3) != 0;

        return Account(
            uint256(storedValue._latestVersion),
            UFixed6.wrap(uint256(isMaker ? storedValue._position : 0)),
            UFixed6.wrap(uint256(isTaker ? storedValue._position : 0)),
            UFixed6.wrap(uint256(isNextMaker ? storedValue._next : 0)),
            UFixed6.wrap(uint256(isNextTaker ? storedValue._next : 0)),
            Fixed6.wrap(int256(storedValue._collateral)),
            UFixed6.wrap(uint256(storedValue._liquidationAndReward & ~LIQUIDATION_MASK)),
            bool(storedValue._liquidationAndReward & LIQUIDATION_MASK != 0)
        );
    }

    function store(AccountStorage storage self, Account memory newValue) internal {
        if (newValue.latestVersion > type(uint24).max) revert AccountStorageInvalidError();
        if (newValue.position().gt(UFixed6Lib.MAX_56)) revert AccountStorageInvalidError();
        if (newValue.next().gt(UFixed6Lib.MAX_56)) revert AccountStorageInvalidError();
        if (newValue.collateral.gt(Fixed6Lib.MAX_56)) revert AccountStorageInvalidError();
        if (newValue.reward.gt(UFixed6.wrap((1 << 55) - 1))) revert AccountStorageInvalidError();

        if (!newValue.nextMaker.isZero() && !newValue.nextTaker.isZero()) revert AccountStorageDoubleSidedError();

        uint256 _positionMask =
            ((newValue.maker.isZero() ? 0 : 1)) |
            ((newValue.taker.isZero() ? 0 : 1) << 1) |
            ((newValue.nextMaker.isZero() ? 0 : 1) << 2) |
            ((newValue.nextTaker.isZero() ? 0 : 1) << 3);

        self.value = StoredAccount(
            uint8(_positionMask),
            uint24(newValue.latestVersion),
            uint56(UFixed6.unwrap(newValue.position())),
            uint56(UFixed6.unwrap(newValue.next())),
            int56(Fixed6.unwrap(newValue.collateral)),
            uint56((UFixed6.unwrap(newValue.reward)) | (uint56(newValue.liquidation ? 1 : 0) << 55))
        );
    }
}