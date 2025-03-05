// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { Fixed6, Fixed6Lib } from "@equilibria/root/number/types/Fixed6.sol";
import { CheckpointAccumulationResponse } from "../libs/CheckpointLib.sol";

/// @dev Local type
struct Local {
    /// @dev The current position id
    uint256 currentId;

    /// @dev The latest position id
    uint256 latestId;

    /// @dev DEPRECATED The collateral balance, used for 2.4 -> 2.5 migration only
    Fixed6 collateral;

    /// @dev DEPRECATED The claimable balance, used for 2.4 -> 2.5 migration only
    UFixed6 claimable;
}
using LocalLib for Local global;
struct LocalStorage { uint256 slot0; uint256 slot1; }
using LocalStorageLib for LocalStorage global;

/// @title Local
/// @dev (external-unsafe): this library must be used internally only
/// @notice Holds the local account state
library LocalLib {
    /// @notice Calculates PnL and updates the position id
    /// @param self The Local object to update
    /// @param accumulation The accumulation result
    function update(
        Local memory self,
        uint256 newId,
        CheckpointAccumulationResponse memory accumulation
    ) internal pure returns (Fixed6 pnl) {
        pnl = accumulation.collateral.sub(Fixed6Lib.from(accumulation.liquidationFee));
        self.latestId = newId;
    }
}

/// @dev Manually encodes and decodes the Local struct into storage.
///      (external-safe): this library is safe to externalize
///
///     struct StoredLocal {
///         /* slot 0 */
///         uint32 currentId;       // <= 4.29b
///         uint32 latestId;        // <= 4.29b
///         int64 collateral;       // <= 9.22t
///         uint64 claimable;       // <= 18.44t
///         bytes4 __DEPRECATED;    // UNSAFE UNTIL RESET
///     }
///
library LocalStorageLib {
    // sig: 0xc83d08ec
    error LocalStorageInvalidError();

    function read(LocalStorage storage self) internal view returns (Local memory) {
        uint256 slot0 = self.slot0;
        return Local(
            uint256(slot0 << (256 - 32)) >> (256 - 32),
            uint256(slot0 << (256 - 32 - 32)) >> (256 - 32),
            Fixed6.wrap(int256(slot0 << (256 - 32 - 32 - 64)) >> (256 - 64)),
            UFixed6.wrap(uint256(slot0 << (256 - 32 - 32 - 64 - 64)) >> (256 - 64))
        );
    }

    function store(LocalStorage storage self, Local memory newValue) internal {
        if (newValue.currentId > uint256(type(uint32).max)) revert LocalStorageInvalidError();
        if (newValue.latestId > uint256(type(uint32).max)) revert LocalStorageInvalidError();
        if (!newValue.collateral.eq(Fixed6Lib.ZERO)) revert LocalStorageInvalidError();
        if (!newValue.claimable.eq(UFixed6Lib.ZERO)) revert LocalStorageInvalidError();

        uint256 encoded0 =
            uint256(newValue.currentId << (256 - 32)) >> (256 - 32) |
            uint256(newValue.latestId << (256 - 32)) >> (256 - 32 - 32) |
            uint256(UFixed6.unwrap(newValue.claimable) << (256 - 64)) >> (256 - 32 - 32 - 64 - 64);

        assembly {
            sstore(self.slot, encoded0)
        }
    }
}