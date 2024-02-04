// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "./OracleVersion.sol";
import "./RiskParameter.sol";
import "./Global.sol";
import "./Local.sol";
import "./Order.sol";

/// @dev Checkpoint type
struct Checkpoint {
    /// @dev The trade fee that the order incurred at the checkpoint settlement
    Fixed6 tradeFee;

    // @dev The settlement fee that the order incurred at the checkpoint settlement
    UFixed6 settlementFee;

    /// @dev The amount deposited or withdrawn at the checkpoint settlement
    Fixed6 transfer;

    /// @dev The collateral at the time of the checkpoint settlement
    Fixed6 collateral;
}
using CheckpointLib for Checkpoint global;
struct CheckpointStorage { uint256 slot0; }
using CheckpointStorageLib for CheckpointStorage global;

/// @title Checkpoint
/// @notice Holds the state for a checkpoint
library CheckpointLib {
    /// @notice Updates the fees of the checkpoint
    /// @param self The checkpoint object to update
    /// @param order The order that was settled
    /// @param collateral The collateral amount incurred at the time of the checkpoint settlement
    /// @param tradeFee The trade fee that the order incurred at the checkpoint settlement
    /// @param settlementFee The settlement fee that the order incurred at the checkpoint settlement
    function update(
        Checkpoint memory self,
        Order memory order,
        Fixed6 collateral,
        Fixed6 tradeFee,
        UFixed6 settlementFee
    ) internal pure {
        self.collateral = self.collateral
            .sub(self.tradeFee)                       // trade fee processed post settlement
            .sub(Fixed6Lib.from(self.settlementFee))  // settlement fee processed post settlement
            .add(self.transfer)                       // deposit / withdrawal processed post settlement
            .add(collateral);                         // incorporate collateral change at this settlement

        // update post settlement collateral changes for next checkpoint
        self.transfer = order.collateral;
        self.tradeFee = tradeFee;
        self.settlementFee = settlementFee;
    }
}

/// @dev Manually encodes and decodes the Checkpoint struct into storage.
///
///     struct StoredCheckpoint {
///         /* slot 0 */
///         int48 tradeFee;
///         uint48 settlementFee;
///         int64 transfer;
///         int64 collateral;
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
        if (newValue.transfer.gt(Fixed6.wrap(type(int64).max))) revert CheckpointStorageInvalidError();
        if (newValue.transfer.lt(Fixed6.wrap(type(int64).min))) revert CheckpointStorageInvalidError();
        if (newValue.collateral.gt(Fixed6.wrap(type(int64).max))) revert CheckpointStorageInvalidError();
        if (newValue.collateral.lt(Fixed6.wrap(type(int64).min))) revert CheckpointStorageInvalidError();

        uint256 encoded0 =
            uint256(Fixed6.unwrap(newValue.tradeFee)        << (256 - 48)) >> (256 - 48) |
            uint256(UFixed6.unwrap(newValue.settlementFee)  << (256 - 48)) >> (256 - 48 - 48) |
            uint256(Fixed6.unwrap(newValue.transfer)        << (256 - 64)) >> (256 - 48 - 48 - 64) |
            uint256(Fixed6.unwrap(newValue.collateral)      << (256 - 64)) >> (256 - 48 - 48 - 64 - 64);

        assembly {
            sstore(self.slot, encoded0)
        }
    }
}
