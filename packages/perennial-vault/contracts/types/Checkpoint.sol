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
    bool initialized;
}
using CheckpointLib for Checkpoint global;
struct StoredCheckpoint {
    uint48 _deposit;
    uint48 _redemption;
    uint56 _shares;
    int56 _assets;
    bool _initialized;
    bytes5 __unallocated__;
}
struct CheckpointStorage { StoredCheckpoint value; }
using CheckpointStorageLib for CheckpointStorage global;

/**
 * @title CheckpointLib
 * @notice
 */
library CheckpointLib {
    function start(Checkpoint memory self, Account memory global, UFixed18 balance) internal pure {
        if (self.initialized) return;
        (self.initialized, self.shares, self.assets) = (
            true,
            global.shares,
            Fixed6Lib.from(UFixed6Lib.from(balance)).sub(Fixed6Lib.from(global.deposit.add(global.assets)))
        );
    }

    function complete(Checkpoint memory self, Fixed6 assets) internal view {
        self.assets = self.assets.add(assets);
    }

    /**
     * @notice Converts a given amount of assets to shares at basis
     * @param assets Number of assets to convert to shares
     * @return Amount of shares for the given assets at basis
     */
    function toShares(Checkpoint memory self, UFixed6 assets) internal pure returns (UFixed6) {
        UFixed6 basisAssets = UFixed6Lib.from(self.assets.max(Fixed6Lib.ZERO));
        return self.shares.isZero() ?
            assets :  // vault is fresh, use par value
            basisAssets.isZero() ?
                assets :  // vault is insolvent, default to par value
                assets.muldiv(self.shares, basisAssets);
    }

    /**
     * @notice Converts a given amount of shares to assets with basis
     * @param shares Number of shares to convert to shares
     * @return Amount of assets for the given shares at basis
     */
    function toAssets(Checkpoint memory self, UFixed6 shares) internal pure returns (UFixed6) {
        UFixed6 basisAssets = UFixed6Lib.from(self.assets.max(Fixed6Lib.ZERO));
        return self.shares.isZero() ?
            shares :  // vault is fresh, use par value
            shares.muldiv(basisAssets, self.shares);
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
            storedValue._initialized
        );
    }

    function store(CheckpointStorage storage self, Checkpoint memory newValue) internal {
        if (newValue.deposit.gt(UFixed6.wrap(type(uint48).max))) revert CheckpointStorageInvalidError();
        if (newValue.redemption.gt(UFixed6.wrap(type(uint48).max))) revert CheckpointStorageInvalidError();
        if (newValue.shares.gt(UFixed6.wrap(type(uint56).max))) revert CheckpointStorageInvalidError();
        if (newValue.assets.gt(Fixed6.wrap(type(int56).max))) revert CheckpointStorageInvalidError();
        if (newValue.assets.lt(Fixed6.wrap(type(int56).min))) revert CheckpointStorageInvalidError();

        self.value = StoredCheckpoint(
            uint48(UFixed6.unwrap(newValue.deposit)),
            uint48(UFixed6.unwrap(newValue.redemption)),
            uint56(UFixed6.unwrap(newValue.shares)),
            int56(Fixed6.unwrap(newValue.assets)),
            newValue.initialized,
            bytes5(0)
        );
    }
}
