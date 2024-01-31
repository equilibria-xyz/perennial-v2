// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/Fixed6.sol";
import "@equilibria/root/accumulator/types/UAccumulator6.sol";
import "@equilibria/root/accumulator/types/Accumulator6.sol";
import "./Version.sol";
import "./Position.sol";
import "./RiskParameter.sol";
import "./OracleVersion.sol";
import "./Order.sol";

/// @dev Local type
struct Local {
    /// @dev The current position id
    uint256 currentId;

    /// @dev The latest position id
    uint256 latestId;

    /// @dev The collateral balance
    Fixed6 collateral;

    /// @dev The timestamp of the latest protection
    uint256 protection;
}
using LocalLib for Local global;
struct LocalStorage { uint256 slot0; }
using LocalStorageLib for LocalStorage global;

/// @title Local
/// @notice Holds the local account state
library LocalLib {
    /// @notice Updates the collateral with the new deposit or withdrwal
    /// @param self The Local object to update
    /// @param transfer The amount to update the collateral by
    function update(Local memory self, Fixed6 transfer) internal pure {
        self.collateral = self.collateral.add(transfer);
    }

    /// @notice Updates the collateral with the new collateral change
    /// @param self The Local object to update
    /// @param collateral The amount to update the collateral by
    /// @param tradeFee The trade fee to subtract from the collateral
    /// @param settlementFee The settlement fee to subtract from the collateral
    /// @param liquidationFee The liquidation fee to subtract from the collateral
    function update(
        Local memory self,
        uint256 newId,
        Fixed6 collateral,
        Fixed6 tradeFee,
        UFixed6 settlementFee,
        UFixed6 liquidationFee
    ) internal pure {
        self.collateral = self.collateral.add(collateral).sub(tradeFee).sub(Fixed6Lib.from(settlementFee)).sub(Fixed6Lib.from(liquidationFee));
        self.latestId = newId;
    }

    /// @notice Updates the Local to put it into a protected state for liquidation
    /// @param self The Local object to update
    /// @param latestVersion The latest oracle version
    /// @param currentTimestamp The current timestamp
    /// @param tryProtect Whether to try to protect the Local
    /// @return Whether the protection was protected
    function protect(
        Local memory self,
        OracleVersion memory latestVersion,
        uint256 currentTimestamp,
        bool tryProtect
    ) internal pure returns (bool) {
        if (!tryProtect || self.protection > latestVersion.timestamp) return false;
        self.protection = currentTimestamp;
        return true;
    }

    // /// @notice Processes the account's protection if it is valid
    // /// @param self The Local object to update
    // /// @param order The latest account order
    // /// @param version The latest version
    // /// @return
    // function processProtection(
    //     Local memory self,
    //     Order memory order,
    //     Version memory version
    // ) internal pure returns (bool) {
    //     if (!version.valid || order.timestamp != self.protection) return false;
    //     self.collateral = self.collateral.sub(Fixed6Lib.from(self.protectionAmount));
    //     return true;
    // }
}

/// @dev Manually encodes and decodes the Local struct into storage.
///
///     struct StoredLocal {
///         /* slot 0 */
///         uint32 currentId;       // <= 4.29b
///         uint32 latestId;        // <= 4.29b
///         int64 collateral;       // <= 9.22t
///         uint64 __unallocated__;
///         uint32 protection;      // <= 4.29b
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
            (uint256(slot0) << (256 - 32 - 32 - 64 - 64 - 32)) >> (256 - 32)
        );
    }

    function store(LocalStorage storage self, Local memory newValue) internal {
        if (newValue.currentId > uint256(type(uint32).max)) revert LocalStorageInvalidError();
        if (newValue.latestId > uint256(type(uint32).max)) revert LocalStorageInvalidError();
        if (newValue.collateral.gt(Fixed6.wrap(type(int64).max))) revert LocalStorageInvalidError();
        if (newValue.collateral.lt(Fixed6.wrap(type(int64).min))) revert LocalStorageInvalidError();
        if (newValue.protection > uint256(type(uint32).max)) revert LocalStorageInvalidError();

        uint256 encoded0 =
            uint256(newValue.currentId << (256 - 32)) >> (256 - 32) |
            uint256(newValue.latestId << (256 - 32)) >> (256 - 32 - 32) |
            uint256(Fixed6.unwrap(newValue.collateral) << (256 - 64)) >> (256 - 32 - 32 - 64) |
            uint256(newValue.protection << (256 - 32)) >> (256 - 32 - 32 - 64 - 64 - 32);
        assembly {
            sstore(self.slot, encoded0)
        }
    }
}