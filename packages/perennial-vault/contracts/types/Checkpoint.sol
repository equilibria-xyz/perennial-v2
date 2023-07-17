// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/UFixed6.sol";
import "./Account.sol";

/// @dev Checkpoint type
struct Checkpoint {
    UFixed6 deposit;
    UFixed6 redemption;
    UFixed6 shares;
    Fixed6 assets;
    UFixed6 fee;
}
using CheckpointLib for Checkpoint global;
struct StoredCheckpoint {
    uint48 _deposit;
    uint48 _redemption;
    uint48 _shares;
    int48 _assets;
    uint48 _fee;
}
struct CheckpointStorage { StoredCheckpoint value; }
using CheckpointStorageLib for CheckpointStorage global;

/**
 * @title CheckpointLib
 * @notice
 */
library CheckpointLib {
    function initialize(Checkpoint memory self, Account memory global, UFixed18 balance) internal pure {
        (self.shares, self.assets) = (
            global.shares,
            Fixed6Lib.from(UFixed6Lib.from(balance)).sub(Fixed6Lib.from(global.deposit.add(global.assets)))
        );
    }

    function update(Checkpoint memory self, UFixed6 deposit, UFixed6 redemption) internal pure {
        (self.deposit, self.redemption) = (self.deposit.add(deposit), self.redemption.add(redemption));
    }

    function complete(Checkpoint memory self, Fixed6 assets, UFixed6 fee) internal pure {
        self.assets = self.assets.add(assets);
        self.fee = fee;
    }

    /**
     * @notice Converts a given amount of assets to shares at basis
     * @param assets Number of assets to convert to shares
     * @return Amount of shares for the given assets at basis
     */
    function toShares(Checkpoint memory self, UFixed6 assets) internal pure returns (UFixed6) {
        if (self.shares.isZero()) return assets;  // vault is fresh, use par value

        // if vault is insolvent, default to par value
        return  self.assets.lte(Fixed6Lib.ZERO) ? assets : _toShares(self, assets);
    }

    /**
     * @notice Converts a given amount of shares to assets with basis
     * @param shares Number of shares to convert to shares
     * @return Amount of assets for the given shares at basis
     */
    function toAssets(Checkpoint memory self, UFixed6 shares) internal pure returns (UFixed6) {
        return self.shares.isZero() ?
            shares :  // vault is fresh, use par value
            _toAssets(self, shares);
    }

    function _toShares(Checkpoint memory self, UFixed6 assets) private pure returns (UFixed6) {
        UFixed6 selfAssets = UFixed6Lib.from(self.assets.max(Fixed6Lib.ZERO));
        return _withSpread(self, assets.muldiv(self.shares, selfAssets));
    }

    function _toAssets(Checkpoint memory self, UFixed6 shares) private pure returns (UFixed6) {
        UFixed6 selfAssets = UFixed6Lib.from(self.assets.max(Fixed6Lib.ZERO));
        return _withSpread(self, shares.muldiv(selfAssets, self.shares));
    }

    function _withSpread(Checkpoint memory self, UFixed6 amount) private pure returns (UFixed6) {
        UFixed6 selfAssets = UFixed6Lib.from(self.assets.max(Fixed6Lib.ZERO));
        UFixed6 totalAmount = self.deposit.add(self.redemption.muldiv(selfAssets, self.shares));
        return totalAmount.isZero() ?
            amount :
            amount.muldiv(totalAmount.sub(self.fee.min(totalAmount)), totalAmount);
    }

    function unhealthy(Checkpoint memory self) internal pure returns (bool) {
        return !self.shares.isZero() && self.assets.lte(Fixed6Lib.ZERO);
    }
}

library CheckpointStorageLib {
    error CheckpointStorageInvalidError();

    function read(CheckpointStorage storage self) internal view returns (Checkpoint memory) {
        StoredCheckpoint memory storedValue = self.value;
        return Checkpoint(
            UFixed6.wrap(uint256(storedValue._deposit)),
            UFixed6.wrap(uint256(storedValue._redemption)),
            UFixed6.wrap(uint256(storedValue._shares)),
            Fixed6.wrap(int256(storedValue._assets)),
            UFixed6.wrap(uint256(storedValue._fee))
        );
    }

    function store(CheckpointStorage storage self, Checkpoint memory newValue) internal {
        if (newValue.deposit.gt(UFixed6.wrap(type(uint48).max))) revert CheckpointStorageInvalidError();
        if (newValue.redemption.gt(UFixed6.wrap(type(uint48).max))) revert CheckpointStorageInvalidError();
        if (newValue.shares.gt(UFixed6.wrap(type(uint48).max))) revert CheckpointStorageInvalidError();
        if (newValue.assets.gt(Fixed6.wrap(type(int48).max))) revert CheckpointStorageInvalidError();
        if (newValue.assets.lt(Fixed6.wrap(type(int48).min))) revert CheckpointStorageInvalidError();
        if (newValue.fee.gt(UFixed6.wrap(type(uint48).max))) revert CheckpointStorageInvalidError();

        self.value = StoredCheckpoint(
            uint48(UFixed6.unwrap(newValue.deposit)),
            uint48(UFixed6.unwrap(newValue.redemption)),
            uint48(UFixed6.unwrap(newValue.shares)),
            int48(Fixed6.unwrap(newValue.assets)),
            uint48(UFixed6.unwrap(newValue.fee))
        );
    }
}
