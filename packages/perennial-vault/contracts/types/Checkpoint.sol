// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root-v2/contracts/UFixed6.sol";

/// @dev Checkpoint type
struct Checkpoint {
    uint256 latest;  // TODO: don't really use this anymore
    UFixed6 deposit;
    UFixed6 redemption;
    UFixed6 shares;
    Fixed6 assets;
    bool started;
    bool completed; // TODO: don't really use this anymore
}
using CheckpointLib for Checkpoint global;
struct StoredCheckpoint {
    uint32 _latest;
    uint48 _deposit;
    uint48 _redemption;
    uint56 _shares;
    int56 _assets;
    bool _started;
    bool _completed;
}
struct CheckpointStorage { StoredCheckpoint value; }
using CheckpointStorageLib for CheckpointStorage global;

/**
 * @title CheckpointLib
 * @notice
 */
library CheckpointLib {
    function start(Checkpoint memory self, UFixed6 shares, Fixed6 assets) internal pure {
        if (!self.started) {
            self.started = true;
            self.shares = shares;
            self.assets = assets; // TODO: can we encapsulate this?
        }
    }

    function complete(Checkpoint memory self, Fixed6 assets) internal pure {
        self.completed = true;
        self.assets = self.assets.add(assets);
    }

    /**
     * @notice Converts a given amount of assets to shares at basis
     * @param assets Number of assets to convert to shares
     * @return Amount of shares for the given assets at basis
     */
    function toShares(Checkpoint memory self, UFixed6 assets) internal pure returns (UFixed6) {
        UFixed6 basisAssets = UFixed6Lib.from(self.assets.max(Fixed6Lib.ZERO)); // TODO: what to do if vault is insolvent
        return basisAssets.isZero() ? assets : assets.muldiv(self.shares, basisAssets);
    }

    /**
     * @notice Converts a given amount of shares to assets with basis
     * @param shares Number of shares to convert to shares
     * @return Amount of assets for the given shares at basis
     */
    function toAssets(Checkpoint memory self, UFixed6 shares) internal pure returns (UFixed6) {
        UFixed6 basisAssets = UFixed6Lib.from(self.assets.max(Fixed6Lib.ZERO)); // TODO: what to do if vault is insolvent
        return self.shares.isZero() ? shares : shares.muldiv(basisAssets, self.shares);
    }
}

library CheckpointStorageLib {
    error CheckpointStorageInvalidError();

    function read(CheckpointStorage storage self) internal view returns (Checkpoint memory) {
        StoredCheckpoint memory storedValue = self.value;
        return Checkpoint(
            uint256(storedValue._latest),
            UFixed6.wrap(uint256(storedValue._deposit)),
            UFixed6.wrap(uint256(storedValue._redemption)),
            UFixed6.wrap(uint256(storedValue._shares)),
            Fixed6.wrap(int256(storedValue._assets)),
            storedValue._started,
            storedValue._completed
        );
    }

    function store(CheckpointStorage storage self, Checkpoint memory newValue) internal {
        if (newValue.latest > type(uint32).max) revert CheckpointStorageInvalidError();
        if (newValue.deposit.gt(UFixed6Lib.MAX_48)) revert CheckpointStorageInvalidError();
        if (newValue.redemption.gt(UFixed6Lib.MAX_48)) revert CheckpointStorageInvalidError();
        if (newValue.shares.gt(UFixed6Lib.MAX_56)) revert CheckpointStorageInvalidError();
        if (newValue.assets.gt(Fixed6Lib.MAX_56)) revert CheckpointStorageInvalidError();
        if (newValue.assets.lt(Fixed6Lib.MIN_56)) revert CheckpointStorageInvalidError();

        self.value = StoredCheckpoint(
            uint32(newValue.latest),
            uint48(UFixed6.unwrap(newValue.deposit)),
            uint48(UFixed6.unwrap(newValue.redemption)),
            uint56(UFixed6.unwrap(newValue.shares)),
            int56(Fixed6.unwrap(newValue.assets)),
            newValue.started,
            newValue.completed
        );
    }
}
