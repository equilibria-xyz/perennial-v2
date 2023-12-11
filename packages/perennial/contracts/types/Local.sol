// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/Fixed6.sol";
import "@equilibria/root/number/types/Fixed6.sol";
import "./Version.sol";
import "./Position.sol";
import "./Order.sol";
import "./RiskParameter.sol";
import "./OracleVersion.sol";

/// @dev Local type
struct Local {
    /// @dev The current position id
    uint256 currentId;

    /// @dev The latest position id
    uint256 latestId;

    /// @dev The collateral balance
    Fixed6 collateral;

    /// @dev The reward balance
    UFixed6 reward;

    /// @dev The timestamp of the latest protection
    uint256 protection;

    /// @dev The initiator of the latest protection
    address protectionInitiator;

    /// @dev The amount of the latest protection fee
    UFixed6 protectionAmount;
}
using LocalLib for Local global;
struct LocalStorage { uint256 slot0; uint256 slot1; }
using LocalStorageLib for LocalStorage global;

/// @title Local
/// @notice Holds the local account state
library LocalLib {
    /// @notice Updates the collateral with the new collateral change
    /// @param self The Local object to update
    /// @param collateral The amount to update the collateral by
    function update(Local memory self, Fixed6 collateral) internal pure {
        self.collateral = self.collateral.add(collateral);
    }

    /// @notice Accumulate pnl from the latest position to next position
    /// @param self The Local object to update
    /// @param latestId The latest position id
    /// @param fromPosition The previous latest position
    /// @param fromVersion The previous latest version
    /// @param toVersion The next latest version
    /// @return collateralAmount The resulting collateral change
    /// @return rewardAmount The resulting reward change
    function accumulatePnl(
        Local memory self,
        uint256 latestId,
        Position memory fromPosition,
        Version memory fromVersion,
        Version memory toVersion
    ) internal pure returns (Fixed6 collateralAmount, UFixed6 rewardAmount) {
        collateralAmount = toVersion.makerValue.accumulated(fromVersion.makerValue, fromPosition.maker)
            .add(toVersion.longValue.accumulated(fromVersion.longValue, fromPosition.long))
            .add(toVersion.shortValue.accumulated(fromVersion.shortValue, fromPosition.short));
        rewardAmount = toVersion.makerReward.accumulated(fromVersion.makerReward, fromPosition.maker)
            .add(toVersion.longReward.accumulated(fromVersion.longReward, fromPosition.long))
            .add(toVersion.shortReward.accumulated(fromVersion.shortReward, fromPosition.short));

        self.collateral = self.collateral.add(collateralAmount);
        self.reward = self.reward.add(rewardAmount);
        self.latestId = latestId;
    }

    /// @notice Accumulate fees from the latest position to next position
    /// @param self The Local object to update
    /// @param toPosition The next latest position
    /// @return positionFee The resulting position fee
    /// @return keeper The resulting keeper fee
    function accumulateFees(
        Local memory self,
        Position memory toPosition
    ) internal pure returns (Fixed6 positionFee, UFixed6 keeper) {
        positionFee = toPosition.fee;
        keeper = toPosition.keeper;

        Fixed6 feeAmount = positionFee.add(Fixed6Lib.from(keeper));
        self.collateral = self.collateral.sub(feeAmount);
    }

    /// @notice Updates the Local to put it into a protected state for liquidation
    /// @param self The Local object to update
    /// @param latestVersion The latest oracle version
    /// @param currentTimestamp The current timestamp
    /// @param tryProtect Whether to try to protect the Local
    /// @return Whether the protection was protected
    function protect(
        Local memory self,
        RiskParameter memory riskParameter,
        OracleVersion memory latestVersion,
        uint256 currentTimestamp,
        Order memory newOrder,
        address initiator,
        bool tryProtect
    ) internal pure returns (bool) {
        if (!tryProtect || self.protection > latestVersion.timestamp) return false;
        (self.protection, self.protectionAmount, self.protectionInitiator) =
            (currentTimestamp, newOrder.liquidationFee(latestVersion, riskParameter), initiator);
        return true;
    }

    /// @notice Clears the local's reward value
    /// @param self The Local object to update
    function clearReward(Local memory self) internal pure {
        self.reward = UFixed6Lib.ZERO;
    }

    /// @notice Processes the account's protection if it is valid
    /// @param self The Local object to update
    /// @param latestPosition The latest account position
    /// @param version The latest version
    /// @return
    function processProtection(
        Local memory self,
        Position memory latestPosition,
        Version memory version
    ) internal pure returns (bool) {
        if (!version.valid || latestPosition.timestamp != self.protection) return false;
        self.collateral = self.collateral.sub(Fixed6Lib.from(self.protectionAmount));
        return true;
    }

    /// @notice Processes the initiator's liquidation fee
    /// @param self The Local object to update
    /// @param initiateeLocal The Local object to process
    function processLiquidationFee(Local memory self, Local memory initiateeLocal) internal pure {
        self.collateral = self.collateral.add(Fixed6Lib.from(initiateeLocal.protectionAmount));
    }

    /// @notice Returns the pending amount of liquidation fee
    /// @dev May or may not realize depending on whether the liquidation version is valid
    /// @param self The Local object
    /// @param latestPosition The latest position
    /// @return The pending liquidation fee
    function pendingLiquidationFee(
        Local memory self,
        Position memory latestPosition
    ) internal pure returns (UFixed6) {
        return self.protection > latestPosition.timestamp ? self.protectionAmount : UFixed6Lib.ZERO;
    }
}

/// @dev Manually encodes and decodes the Local struct into storage.
///
///     struct StoredLocal {
///         /* slot 0 */
///         uint32 currentId;   // <= 4.29b
///         uint32 latestId;    // <= 4.29b
///         int64 collateral;   // <= 9.22t
///         uint64 reward;      // <= 18.44t
///         uint32 protection;  // <= 4.29b
///
///         /* slot 1 */
///         address protectionInitiator;    
///         uint64 protectionAmount;        // <= 18.44t
///     }
///
library LocalStorageLib {
    // sig: 0xc83d08ec
    error LocalStorageInvalidError();

    function read(LocalStorage storage self) internal view returns (Local memory) {
        (uint256 slot0, uint256 slot1) = (self.slot0, self.slot1);
        return Local(
            uint256(slot0 << (256 - 32)) >> (256 - 32),
            uint256(slot0 << (256 - 32 - 32)) >> (256 - 32),
            Fixed6.wrap(int256(slot0 << (256 - 32 - 32 - 64)) >> (256 - 64)),
            UFixed6.wrap(uint256(slot0 << (256 - 32 - 32 - 64 - 64)) >> (256 - 64)),
            (uint256(slot0) << (256 - 32 - 32 - 64 - 64 - 32)) >> (256 - 32),
            address(uint160(uint256(slot1 << (256 - 160)) >> (256 - 160))),
            UFixed6.wrap(uint256(slot1 << (256 - 160 - 64)) >> (256 - 64))
        );
    }

    function store(LocalStorage storage self, Local memory newValue) internal {
        if (newValue.currentId > uint256(type(uint32).max)) revert LocalStorageInvalidError();
        if (newValue.latestId > uint256(type(uint32).max)) revert LocalStorageInvalidError();
        if (newValue.collateral.gt(Fixed6.wrap(type(int64).max))) revert LocalStorageInvalidError();
        if (newValue.collateral.lt(Fixed6.wrap(type(int64).min))) revert LocalStorageInvalidError();
        if (newValue.reward.gt(UFixed6.wrap(type(uint64).max))) revert LocalStorageInvalidError();
        if (newValue.protection > uint256(type(uint32).max)) revert LocalStorageInvalidError();
        if (newValue.protectionAmount.gt(UFixed6.wrap(type(uint64).max))) revert LocalStorageInvalidError();

        uint256 encoded0 =
            uint256(newValue.currentId << (256 - 32)) >> (256 - 32) |
            uint256(newValue.latestId << (256 - 32)) >> (256 - 32 - 32) |
            uint256(Fixed6.unwrap(newValue.collateral) << (256 - 64)) >> (256 - 32 - 32 - 64) |
            uint256(UFixed6.unwrap(newValue.reward) << (256 - 64)) >> (256 - 32 - 32 - 64 - 64) |
            uint256(newValue.protection << (256 - 32)) >> (256 - 32 - 32 - 64 - 64 - 32);
        uint256 encoded1 =
            uint256(uint256(uint160(newValue.protectionInitiator)) << (256 - 160)) >> (256 - 160) |
            uint256(UFixed6.unwrap(newValue.protectionAmount) << (256 - 64)) >> (256 - 160 - 64);
        assembly {
            sstore(self.slot, encoded0)
            sstore(add(self.slot, 1), encoded1)
        }
    }
}