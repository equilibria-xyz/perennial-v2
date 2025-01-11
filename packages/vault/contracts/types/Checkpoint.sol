// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { UFixed18, UFixed18Lib } from "@equilibria/root/number/types/UFixed18.sol";
import { Fixed6, Fixed6Lib } from "@equilibria/root/number/types/Fixed6.sol";
import { Checkpoint as PerennialCheckpoint } from "@perennial/v2-core/contracts/types/Checkpoint.sol";
import { Account } from "./Account.sol";
import { VaultParameter } from "./VaultParameter.sol";

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
    Fixed6 tradeFee;

    /// @dev The total settlement fee at the checkpoint
    UFixed6 settlementFee;

    /// @dev The number of deposits and redemptions during the checkpoint
    uint256 deposits;

    /// @dev The number of deposits and redemptions during the checkpoint
    uint256 redemptions;

    // @dev The timestamp of of the checkpoint
    uint256 timestamp;
}
using CheckpointLib for Checkpoint global;
struct StoredCheckpoint {
    /* slot 0 */
    uint64 deposit;         // <= 18.44t
    uint64 redemption;      // <= 18.44t
    uint64 shares;          // <= 18.44t
    int64 assets;           // <= 9.22t

    /* slot 1 */
    int64 tradeFee;         // <= 9.22t
    uint64 settlementFee;   // <= 18.44t
    uint32 deposits;        // <= 4.29b
    uint32 timestamp;       // <= 4.29b
    uint32 redemptions;
    bytes4 __unallocated0__;
}
struct CheckpointStorage { StoredCheckpoint value; }
using CheckpointStorageLib for CheckpointStorage global;

/// @title Checkpoint
/// @dev (external-unsafe): this library must be used internally only
/// @notice Holds the state for the checkpoint type
library CheckpointLib {
    /// @notice Initializes the checkpoint
    /// @dev Saves the current shares, and the assets + liabilities in the vault itself (not in the markets)
    /// @param self The checkpoint to initialize
    /// @param timestamp The timestamp of the checkpoint
    /// @param global The global account
    function next(Checkpoint memory self, uint256 timestamp, Account memory global) internal pure {
        (self.timestamp, self.shares, self.assets) =
            (timestamp, global.shares, Fixed6Lib.from(-1, global.deposit.add(global.assets)));
        (self.deposit, self.redemption, self.tradeFee, self.settlementFee, self.deposits, self.redemptions) =
            (UFixed6Lib.ZERO, UFixed6Lib.ZERO, Fixed6Lib.ZERO, UFixed6Lib.ZERO, 0, 0);
    }

    /// @notice Updates the checkpoint with a new deposit or redemption
    /// @param self The checkpoint to update
    /// @param deposit The amount of new deposits
    /// @param redemption The amount of new redemptions
    function update(Checkpoint memory self, UFixed6 deposit, UFixed6 redemption) internal pure {
        (self.deposit, self.redemption) =
            (self.deposit.add(deposit), self.redemption.add(redemption));
        if (!deposit.isZero()) self.deposits++;
        if (!redemption.isZero()) self.redemptions++;
    }

    /// @notice Completes the checkpoint
    /// @dev Increments the assets by the snapshotted amount of collateral in the underlying markets
    /// @param self The checkpoint to complete
    /// @param mark The high-water mark of the vault prior to this completion
    /// @param parameter The vault parameter
    /// @param marketCheckpoint The checkpoint to complete with
    /// @return newMark The new high-water mark for the vault
    /// @return profitShares The newly minted profit shares for the checkpoint
    function complete(
        Checkpoint memory self,
        UFixed18 mark,
        VaultParameter memory parameter,
        PerennialCheckpoint memory marketCheckpoint
    ) internal pure returns (UFixed18 newMark, UFixed6 profitShares) {
        // finalize vault collateral
        self.assets = self.assets.add(marketCheckpoint.collateral);

        // apply profit share
        (newMark, profitShares) = _calculateProfitShare(self, mark, parameter);
        self.shares = self.shares.add(profitShares);

        // apply fees
        self.tradeFee = marketCheckpoint.tradeFee;
        self.settlementFee = marketCheckpoint.settlementFee;
    }

    /// @notice Calculates the profit share for the checkpoint
    /// @dev The coordinator accrues a percentage of the Vault's profit over the high-water mark in the form of shares
    /// @param self The checkpoint to calculate the profit share for
    /// @param mark The The high-water mark of the vault prior to this completion
    /// @param parameter The vault parameter
    /// @return newMark The new high-water mark for the vault
    /// @return profitShares The newly minted profit shares for the checkpoint
    function _calculateProfitShare(
        Checkpoint memory self,
        UFixed18 mark,
        VaultParameter memory parameter
    ) private pure returns (UFixed18 newMark, UFixed6 profitShares) {
        // vault is fresh, use par value
        if (self.shares.isZero()) return (UFixed18Lib.ONE, UFixed6Lib.ZERO);

        // calculate new mark
        newMark = mark.max(UFixed18Lib.from(UFixed6Lib.unsafeFrom(self.assets)).div(UFixed18Lib.from(self.shares)));

        // vault did not previously have a mark (migration)
        if (mark.isZero()) return (newMark, UFixed6Lib.ZERO);

        // calculate new profit assets
        UFixed6 profitAssets = parameter.profitShare
            .mul(UFixed6Lib.from(newMark.sub(mark).mul(UFixed18Lib.from(self.shares))));

        // no assets in vault
        if (UFixed6Lib.unsafeFrom(self.assets).sub(profitAssets).isZero()) return (newMark, UFixed6Lib.ZERO);

        // calculate new profit shares
        profitShares = profitAssets.mul(self.shares).div(UFixed6Lib.unsafeFrom(self.assets).sub(profitAssets));
    }

    /// @notice Converts a given amount of assets to shares at checkpoint in the global context
    /// @param assets Number of assets to convert to shares
    /// @return Amount of shares for the given assets at checkpoint
    function toSharesGlobal(Checkpoint memory self, UFixed6 assets) internal pure returns (UFixed6) {
        // vault is fresh, use par value
        if (self.shares.isZero()) return assets;

        // if vault is insolvent, default to par value
        UFixed6 settlementFee = _settlementFeeForOrders(self, self.deposits);
        return self.assets.lte(Fixed6Lib.ZERO) ?
            assets.unsafeSub(settlementFee) :
            _toShares(self, assets).unsafeSub(_toSharesExact(self, settlementFee));
    }

    /// @notice Converts a given amount of shares to assets with checkpoint in the global context
    /// @param shares Number of shares to convert to shares
    /// @return Amount of assets for the given shares at checkpoint
    function toAssetsGlobal(Checkpoint memory self, UFixed6 shares) internal pure returns (UFixed6) {
        // vault is fresh, use par value
        UFixed6 settlementFee = _settlementFeeForOrders(self, self.redemptions);
        return (self.shares.isZero() ? shares : _toAssets(self, shares)).unsafeSub(settlementFee);
    }

    /// @notice Converts a given amount of assets to shares at checkpoint in the local context
    /// @param assets Number of assets to convert to shares
    /// @return Amount of shares for the given assets at checkpoint
    function toSharesLocal(Checkpoint memory self, UFixed6 assets) internal pure returns (UFixed6) {
        // vault is fresh, use par value
        if (self.shares.isZero()) return assets;

        // if vault is insolvent, default to par value
        UFixed6 settlementFee = _settlementFeeForOrders(self, 1);
        return self.assets.lte(Fixed6Lib.ZERO) ?
            assets.unsafeSub(settlementFee) :
            _toShares(self, assets).unsafeSub(_toSharesExact(self, settlementFee));
    }

    /// @notice Converts a given amount of shares to assets with checkpoint in the local context
    /// @param shares Number of shares to convert to shares
    /// @return Amount of assets for the given shares at checkpoint
    function toAssetsLocal(Checkpoint memory self, UFixed6 shares) internal pure returns (UFixed6) {
        // vault is fresh, use par value
        UFixed6 settlementFee = _settlementFeeForOrders(self, 1);
        return (self.shares.isZero() ? shares : _toAssets(self, shares)).unsafeSub(settlementFee);
    }

    /// @notice Converts a given amount of shares to assets with checkpoint in the global context
    /// @dev Dev used in limit calculations when no settlement fee is available
    /// @param shares Number of shares to convert to shares
    /// @return Amount of assets for the given shares at checkpoint
    function toAssets(Checkpoint memory self, UFixed6 shares) internal pure returns (UFixed6) {
        // vault is fresh, use par value
        return (self.shares.isZero() ? shares : _toAssets(self, shares));
    }

    /// @notice Converts a given amount of assets to shares at checkpoint
    /// @param assets Number of assets to convert to shares
    /// @return Amount of shares for the given assets at checkpoint
    function _toShares(Checkpoint memory self, UFixed6 assets) private pure returns (UFixed6) {
        return _withSpread(self, _toSharesExact(self, assets));
    }

    /// @notice Converts a given amount of shares to assets with checkpoint
    /// @param shares Number of shares to convert to shares
    /// @return Amount of assets for the given shares at checkpoint
    function _toAssets(Checkpoint memory self, UFixed6 shares) private pure returns (UFixed6) {
        return _withSpread(self, _toAssetsExact(self, shares));
    }

    /// @notice Applies a spread to a given amount from the relative fee amount of the checkpoint
    /// @param self The checkpoint to apply the spread to
    /// @param amount The amount to apply the spread to
    function _withSpread(Checkpoint memory self, UFixed6 amount) private pure returns (UFixed6) {
        UFixed6 totalAmount = self.deposit.add(_toAssetsExact(self, self.redemption));
        UFixed6 totalAmountIncludingFee = UFixed6Lib.unsafeFrom(Fixed6Lib.from(totalAmount).sub(self.tradeFee));

        return totalAmount.isZero() ?
            amount :
            amount.muldiv(totalAmountIncludingFee, totalAmount);
    }

    function _settlementFeeForOrders(Checkpoint memory self, uint256 orders) private pure returns (UFixed6) {
        UFixed6 totalOrders = UFixed6Lib.from(self.deposits + self.redemptions);
        return totalOrders.isZero() ?
            UFixed6Lib.ZERO :
            self.settlementFee.muldivOut(UFixed6Lib.from(orders), totalOrders);
    }

    function _toAssetsExact(Checkpoint memory self, UFixed6 shares) private pure returns (UFixed6) {
        return shares.muldiv(UFixed6Lib.unsafeFrom(self.assets), self.shares);
    }

    function _toSharesExact(Checkpoint memory self, UFixed6 assets) private pure returns (UFixed6) {
        return assets.muldiv(self.shares, UFixed6Lib.unsafeFrom(self.assets));
    }

    /// @notice Returns if the checkpoint is healthy
    /// @dev A checkpoint is unhealthy when it has shares but no assets, since this cannot be recovered from
    /// @param self The checkpoint to check
    /// @return Whether the checkpoint is healthy
    function unhealthy(Checkpoint memory self) internal pure returns (bool) {
        return !self.shares.isZero() && self.assets.lte(Fixed6Lib.ZERO);
    }
}

/// @dev (external-safe): this library is safe to externalize
library CheckpointStorageLib {
    // sig: 0xba85116a
    error CheckpointStorageInvalidError();

    function read(CheckpointStorage storage self) internal view returns (Checkpoint memory) {
        StoredCheckpoint memory storedValue = self.value;
        return Checkpoint(
            UFixed6.wrap(uint256(storedValue.deposit)),
            UFixed6.wrap(uint256(storedValue.redemption)),
            UFixed6.wrap(uint256(storedValue.shares)),
            Fixed6.wrap(int256(storedValue.assets)),
            Fixed6.wrap(int256(storedValue.tradeFee)),
            UFixed6.wrap(uint256(storedValue.settlementFee)),
            uint256(storedValue.deposits),
            uint256(storedValue.redemptions),
            uint256(storedValue.timestamp)
        );
    }

    function store(CheckpointStorage storage self, Checkpoint memory newValue) internal {
        if (newValue.deposit.gt(UFixed6.wrap(type(uint64).max))) revert CheckpointStorageInvalidError();
        if (newValue.redemption.gt(UFixed6.wrap(type(uint64).max))) revert CheckpointStorageInvalidError();
        if (newValue.shares.gt(UFixed6.wrap(type(uint64).max))) revert CheckpointStorageInvalidError();
        if (newValue.assets.gt(Fixed6.wrap(type(int64).max))) revert CheckpointStorageInvalidError();
        if (newValue.assets.lt(Fixed6.wrap(type(int64).min))) revert CheckpointStorageInvalidError();
        if (newValue.tradeFee.gt(Fixed6.wrap(type(int64).max))) revert CheckpointStorageInvalidError();
        if (newValue.tradeFee.lt(Fixed6.wrap(type(int64).min))) revert CheckpointStorageInvalidError();
        if (newValue.settlementFee.gt(UFixed6.wrap(type(uint64).max))) revert CheckpointStorageInvalidError();
        if (newValue.deposits > uint256(type(uint32).max)) revert CheckpointStorageInvalidError();
        if (newValue.redemptions > uint256(type(uint32).max)) revert CheckpointStorageInvalidError();
        if (newValue.timestamp > uint256(type(uint32).max)) revert CheckpointStorageInvalidError();

        self.value = StoredCheckpoint(
            uint64(UFixed6.unwrap(newValue.deposit)),
            uint64(UFixed6.unwrap(newValue.redemption)),
            uint64(UFixed6.unwrap(newValue.shares)),
            int64(Fixed6.unwrap(newValue.assets)),

            int64(Fixed6.unwrap(newValue.tradeFee)),
            uint64(UFixed6.unwrap(newValue.settlementFee)),
            uint32(newValue.deposits),
            uint32(newValue.timestamp),
            uint32(newValue.redemptions),
            bytes4(0)
        );
    }
}
