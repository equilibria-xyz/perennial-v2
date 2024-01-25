// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "./OracleVersion.sol";
import "./RiskParameter.sol";
import "./Global.sol";
import "./Local.sol";
import "./Invalidation.sol";
import "./Order.sol";

/// @dev Checkpoint type
struct Checkpoint {
    /// @dev The trade fee that the order incurred at the checkpoint settlement
    Fixed6 tradeFee;

    // @dev The settlement fee that the order incurred  at the checkpoint settlement
    UFixed6 settlementFee;

    /// @dev The collateral at the time of the checkpoint settlement
    Fixed6 collateral;

    /// @dev The change in collateral during this checkpoint
    Fixed6 delta;
}
using CheckpointLib for Checkpoint global;
struct CheckpointStorage { uint256 slot0; }
using CheckpointStorageLib for CheckpointStorage global;

/// @title Checkpoint
/// @notice Holds the state for a checkpoint
library CheckpointLib {
    /// @notice Updates the checkpoint with the latest collateral snapshot
    /// @param self The checkpoint object to update
    /// @param previousCheckpoint The previous checkpoint object
    /// @param currentCheckpoint The current checkpoint object
    /// @param collateral The current collateral amount
    function updateCollateral(
        Checkpoint memory self,
        Checkpoint memory previousCheckpoint,
        Checkpoint memory currentCheckpoint,
        Fixed6 collateral
    ) internal pure {
        self.collateral = collateral.sub(currentCheckpoint.delta.sub(previousCheckpoint.delta)); // deposits happen after snapshot point
    }

    /// @notice Updates the fees of the checkpoint
    /// @param self The checkpoint object to update
    /// @param tradeFee The trade fee that the order incurred at the checkpoint settlement
    /// @param settlementFee The settlement fee that the order incurred at the checkpoint settlement
    function updateFees(
        Checkpoint memory self,
        Fixed6 tradeFee,
        UFixed6 settlementFee
    ) internal pure {
        self.tradeFee = tradeFee;
        self.settlementFee = settlementFee;
    }

    /// @notice Updates the collateral delta of the checkpoint
    /// @param self The checkpoint object to update
    /// @param collateral The amount of collateral change that occurred
    function updateDelta(Checkpoint memory self, Fixed6 collateral) internal pure {
        self.delta = self.delta.add(collateral);
    }

    /// @notice Zeroes out non-accumulator values to create a fresh next checkpoint
    /// @param self The checkpoint object to update
    function next(Checkpoint memory self) internal pure {
        self.tradeFee = Fixed6Lib.ZERO;
        self.settlementFee = UFixed6Lib.ZERO;
        self.collateral = Fixed6Lib.ZERO;        
    }
}

/// @dev Manually encodes and decodes the Checkpoint struct into storage.
///
///     struct StoredCheckpoint {
///         /* slot 0 */
///         int48 tradeFee;
///         uint48 settlementFee;
///         int64 collateral;
///         int64 delta;
///     }
///
library CheckpointStorageLib {
    // sig: 0xba85116a
    error CheckpointStorageInvalidError();

    function read(CheckpointStorage storage self) internal view returns (Checkpoint memory) {
        uint256 slot0 = self.slot0;
        return Checkpoint(
            Fixed6.wrap(int256(slot0 << (256 - 48)) >> (256 - 48)),
            UFixed6.wrap(uint256(slot0 << (256 - 48 - 48)) >> (256 - 48)),
            Fixed6.wrap(int256(slot0 << (256 - 48 - 48 - 64)) >> (256 - 64)),
            Fixed6.wrap(int256(slot0 << (256 - 48 - 48 - 64 - 64)) >> (256 - 64))
        );
    }

    function store(CheckpointStorage storage self, Checkpoint memory newValue) internal {
        if (newValue.tradeFee.gt(Fixed6.wrap(type(int48).max))) revert CheckpointStorageInvalidError();
        if (newValue.tradeFee.lt(Fixed6.wrap(type(int48).min))) revert CheckpointStorageInvalidError();
        if (newValue.settlementFee.gt(UFixed6.wrap(type(uint48).max))) revert CheckpointStorageInvalidError();
        if (newValue.collateral.gt(Fixed6.wrap(type(int64).max))) revert CheckpointStorageInvalidError();
        if (newValue.collateral.lt(Fixed6.wrap(type(int64).min))) revert CheckpointStorageInvalidError();
        if (newValue.delta.gt(Fixed6.wrap(type(int64).max))) revert CheckpointStorageInvalidError();
        if (newValue.delta.lt(Fixed6.wrap(type(int64).min))) revert CheckpointStorageInvalidError();

        uint256 encoded0 =
            uint256(Fixed6.unwrap(newValue.tradeFee)        << (256 - 48)) >> (256 - 48) |
            uint256(UFixed6.unwrap(newValue.settlementFee)  << (256 - 48)) >> (256 - 48 - 48) |
            uint256(Fixed6.unwrap(newValue.collateral)      << (256 - 64)) >> (256 - 48 - 48 - 64) |
            uint256(Fixed6.unwrap(newValue.delta)           << (256 - 64)) >> (256 - 48 - 48 - 64 - 64);

        assembly {
            sstore(self.slot, encoded0)
        }
    }
}
