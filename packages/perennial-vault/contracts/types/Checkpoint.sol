// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/UFixed6.sol";
import "./Account.sol";

/// @dev Checkpoint type
struct Checkpoint {
    /// @dev The total amount of pending deposits
    UFixed6 deposit;

    /// @dev The total amount of pending redemptions
    UFixed6 redemption;

    /// @dev The total shares at the checkpoint
    UFixed6 shares;

    /// @dev The total assets at the checkpoint
    Fixed6 assets;

    /// @dev The total fee at the checkpoint
    UFixed6 fee;

    /// @dev The total settlement fee at the checkpoint
    UFixed6 keeper;

    /// @dev The number of deposits and redemptions during the checkpoint
    uint256 count;
}
using CheckpointLib for Checkpoint global;
struct StoredCheckpoint {
    /* slot 0 */
    uint64 deposit;         // <= 18.44t
    uint64 redemption;      // <= 18.44t
    uint64 shares;          // <= 18.44t
    int64 assets;           // <= 9.22t

    /* slot 1 */
    uint64 fee;             // <= 18.44t
    uint64 keeper;          // <= 18.44t
    uint32 count;           // <= 4.29b
    bytes12 __unallocated1__;
}
struct CheckpointStorage { StoredCheckpoint value; }
using CheckpointStorageLib for CheckpointStorage global;

/// @title Checkpoint
/// @notice Holds the state for the checkpoint type
library CheckpointLib {
    /// @notice Initializes the checkpoint
    /// @dev Saves the current shares, and the assets + liabilities in the vault itself (not in the markets)
    /// @param self The checkpoint to initialize
    /// @param global The global account
    /// @param balance The balance of the vault
    function initialize(Checkpoint memory self, Account memory global, UFixed18 balance) internal pure {
        (self.shares, self.assets) = (
            global.shares,
            Fixed6Lib.from(UFixed6Lib.from(balance)).sub(Fixed6Lib.from(global.deposit.add(global.assets)))
        );
    }

    /// @notice Updates the checkpoint with a new deposit or redemption
    /// @param self The checkpoint to update
    /// @param deposit The amount of new deposits
    /// @param redemption The amount of new redemptions
    function update(Checkpoint memory self, UFixed6 deposit, UFixed6 redemption) internal pure {
        (self.deposit, self.redemption) = (self.deposit.add(deposit), self.redemption.add(redemption));
        self.count++;
    }

    /// @notice Completes the checkpoint
    /// @dev Increments the assets by the snapshotted amount of collateral in the underlying markets
    /// @param self The checkpoint to complete
    /// @param assets The amount of assets in the underlying markets
    /// @param fee The fee to register
    /// @param keeper The settlement fee to register
    function complete(Checkpoint memory self, Fixed6 assets, UFixed6 fee, UFixed6 keeper) internal pure {
        self.assets = self.assets.add(assets);
        self.fee = fee;
        self.keeper = keeper;
    }

    /// @notice Converts a given amount of assets to shares at checkpoint in the global context
    /// @param assets Number of assets to convert to shares
    /// @return Amount of shares for the given assets at checkpoint
    function toSharesGlobal(Checkpoint memory self, UFixed6 assets) internal pure returns (UFixed6) {
        // vault is fresh, use par value
        if (self.shares.isZero()) return assets;

        // if vault is insolvent, default to par value
        return  self.assets.lte(Fixed6Lib.ZERO) ? assets : _toShares(self, _withoutKeeperGlobal(self, assets));
    }

    /// @notice Converts a given amount of shares to assets with checkpoint in the global context
    /// @param shares Number of shares to convert to shares
    /// @return Amount of assets for the given shares at checkpoint
    function toAssetsGlobal(Checkpoint memory self, UFixed6 shares) internal pure returns (UFixed6) {
        // vault is fresh, use par value
        return _withoutKeeperGlobal(self, self.shares.isZero() ? shares : _toAssets(self, shares));
    }


    /// @notice Converts a given amount of assets to shares at checkpoint in the local context
    /// @param assets Number of assets to convert to shares
    /// @return Amount of shares for the given assets at checkpoint
    function toSharesLocal(Checkpoint memory self, UFixed6 assets) internal pure returns (UFixed6) {
        // vault is fresh, use par value
        if (self.shares.isZero()) return assets;

        // if vault is insolvent, default to par value
        return  self.assets.lte(Fixed6Lib.ZERO) ? assets : _toShares(self, _withoutKeeperLocal(self, assets));
    }

    /// @notice Converts a given amount of shares to assets with checkpoint in the local context
    /// @param shares Number of shares to convert to shares
    /// @return Amount of assets for the given shares at checkpoint
    function toAssetsLocal(Checkpoint memory self, UFixed6 shares) internal pure returns (UFixed6) {
        // vault is fresh, use par value
        return _withoutKeeperLocal(self, self.shares.isZero() ? shares : _toAssets(self, shares));
    }

    /// @notice Converts a given amount of assets to shares at checkpoint in the global context
    /// @dev Dev used in limit calculations when a non-historical keeper fee must be used
    /// @param assets Number of assets to convert to shares
    /// @param keeper Custom keeper fee
    /// @return Amount of shares for the given assets at checkpoint
    function toShares(Checkpoint memory self, UFixed6 assets, UFixed6 keeper) internal pure returns (UFixed6) {
        // vault is fresh, use par value
        if (self.shares.isZero()) return assets;

        // if vault is insolvent, default to par value
        return  self.assets.lte(Fixed6Lib.ZERO) ? assets : _toShares(self, _withoutKeeper(assets, keeper));
    }

    /// @notice Converts a given amount of shares to assets with checkpoint in the global context
    /// @dev Dev used in limit calculations when a non-historical keeper fee must be used
    /// @param shares Number of shares to convert to shares
    /// @param keeper Custom keeper fee
    /// @return Amount of assets for the given shares at checkpoint
    function toAssets(Checkpoint memory self, UFixed6 shares, UFixed6 keeper) internal pure returns (UFixed6) {
        // vault is fresh, use par value
        return _withoutKeeper(self.shares.isZero() ? shares : _toAssets(self, shares), keeper);
    }

    /// @notice Converts a given amount of assets to shares at checkpoint
    /// @param assets Number of assets to convert to shares
    /// @return Amount of shares for the given assets at checkpoint
    function _toShares(Checkpoint memory self, UFixed6 assets) private pure returns (UFixed6) {
        UFixed6 selfAssets = UFixed6Lib.from(self.assets.max(Fixed6Lib.ZERO));
        return _withSpread(self, assets.muldiv(self.shares, selfAssets));
    }

    /// @notice Converts a given amount of shares to assets with checkpoint
    /// @param shares Number of shares to convert to shares
    /// @return Amount of assets for the given shares at checkpoint
    function _toAssets(Checkpoint memory self, UFixed6 shares) private pure returns (UFixed6) {
        UFixed6 selfAssets = UFixed6Lib.from(self.assets.max(Fixed6Lib.ZERO));
        return _withSpread(self, shares.muldiv(selfAssets, self.shares));
    }

    /// @notice Applies a spread to a given amount from the relative fee amount of the checkpoint
    /// @param self The checkpoint to apply the spread to
    /// @param amount The amount to apply the spread to
    function _withSpread(Checkpoint memory self, UFixed6 amount) private pure returns (UFixed6) {
        UFixed6 selfAssets = UFixed6Lib.from(self.assets.max(Fixed6Lib.ZERO));
        UFixed6 totalAmount = self.deposit.add(self.redemption.muldiv(selfAssets, self.shares));

        return totalAmount.isZero() ?
            amount :
            amount.muldiv(totalAmount.sub(self.fee.min(totalAmount)), totalAmount);
    }

    /// @notice Applies the fixed settlement fee to a given amount in the global context
    /// @param self The checkpoint to apply the fee to
    /// @param amount The amount to apply the fee to
    /// @return The amount with the settlement fee
    function _withoutKeeperGlobal(Checkpoint memory self, UFixed6 amount) private pure returns (UFixed6) {
        return _withoutKeeper(amount, self.keeper);
    }

    /// @notice Applies the fixed settlement fee to a given amount in the local context
    /// @param self The checkpoint to apply the fee to
    /// @param amount The amount to apply the fee to
    /// @return The amount with the settlement fee
    function _withoutKeeperLocal(Checkpoint memory self, UFixed6 amount) private pure returns (UFixed6) {
        UFixed6 keeperPer = self.count == 0 ? UFixed6Lib.ZERO : self.keeper.div(UFixed6Lib.from(self.count));
        return _withoutKeeper(amount, keeperPer);
    }

    /// @notice Applies the fixed settlement fee to a given amount in the local context
    /// @param amount The amount to apply the fee to
    /// @param keeper The amount of settlement fee to deduct
    /// @return The amount with the settlement fee
    function _withoutKeeper(UFixed6 amount, UFixed6 keeper) private pure returns (UFixed6) {
        return amount.sub(keeper.min(amount));
    }

    /// @notice Returns if the checkpoint is healthy
    /// @dev A checkpoint is unhealthy when it has shares but no assets, since this cannot be recovered from
    /// @param self The checkpoint to check
    /// @return Whether the checkpoint is healthy
    function unhealthy(Checkpoint memory self) internal pure returns (bool) {
        return !self.shares.isZero() && self.assets.lte(Fixed6Lib.ZERO);
    }
}

library CheckpointStorageLib {
    error CheckpointStorageInvalidError();

    function read(CheckpointStorage storage self) internal view returns (Checkpoint memory) {
        StoredCheckpoint memory storedValue = self.value;
        return Checkpoint(
            UFixed6.wrap(uint256(storedValue.deposit)),
            UFixed6.wrap(uint256(storedValue.redemption)),
            UFixed6.wrap(uint256(storedValue.shares)),
            Fixed6.wrap(int256(storedValue.assets)),
            UFixed6.wrap(uint256(storedValue.fee)),
            UFixed6.wrap(uint256(storedValue.keeper)),
            uint256(storedValue.count)
        );
    }

    function store(CheckpointStorage storage self, Checkpoint memory newValue) internal {
        if (newValue.deposit.gt(UFixed6.wrap(type(uint64).max))) revert CheckpointStorageInvalidError();
        if (newValue.redemption.gt(UFixed6.wrap(type(uint64).max))) revert CheckpointStorageInvalidError();
        if (newValue.shares.gt(UFixed6.wrap(type(uint64).max))) revert CheckpointStorageInvalidError();
        if (newValue.assets.gt(Fixed6.wrap(type(int64).max))) revert CheckpointStorageInvalidError();
        if (newValue.assets.lt(Fixed6.wrap(type(int64).min))) revert CheckpointStorageInvalidError();
        if (newValue.fee.gt(UFixed6.wrap(type(uint64).max))) revert CheckpointStorageInvalidError();
        if (newValue.count > uint256(type(uint32).max)) revert CheckpointStorageInvalidError();
        if (newValue.keeper.gt(UFixed6.wrap(type(uint64).max))) revert CheckpointStorageInvalidError();

        self.value = StoredCheckpoint(
            uint64(UFixed6.unwrap(newValue.deposit)),
            uint64(UFixed6.unwrap(newValue.redemption)),
            uint64(UFixed6.unwrap(newValue.shares)),
            int64(Fixed6.unwrap(newValue.assets)),

            uint64(UFixed6.unwrap(newValue.fee)),
            uint64(UFixed6.unwrap(newValue.keeper)),
            uint32(newValue.count),
            bytes12(0)
        );
    }
}
