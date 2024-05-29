// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { UFixed6 } from "@equilibria/root/number/types/UFixed6.sol";
import { Action, ActionLib } from "./Action.sol";

/// @dev Rebalancing configuration for a single market
struct RebalanceConfig {
    /// @dev Percentage of collateral from the group to deposit into the market
    UFixed6 target;
    /// @dev Percentage away from the target at which keepers may rebalance
    UFixed6 threshold;
}
struct RebalanceConfigStorage { uint256 slot0; }
using RebalanceConfigLib for RebalanceConfigStorage global;

/// @title RebalanceConfigLib
/// @notice Library used to hash and manage storage for rebalancing configuration for a single market
library RebalanceConfigLib {
    UFixed6 private constant MAX_PERCENT = UFixed6.wrap(1e6); // 100%

    /// sig: 0xd673935e
    error RebalanceConfigStorageInvalidError();

    /// @dev extracts two unsigned values from a single storage slot
    function read(RebalanceConfigStorage storage self) internal view returns (RebalanceConfig memory) {
        uint256 slot0 = self.slot0;
        return RebalanceConfig(
            UFixed6.wrap(uint256(slot0 << (256 - 128)) >> (256 - 128)),
            UFixed6.wrap(uint256(slot0 << (256 - 128 - 128)) >> (256 - 128))
        );
    }

    /// @dev ensures values do not exceed 100% and writes them to a single storage slot
    function store(RebalanceConfigStorage storage self, RebalanceConfig memory newValue) external {
        if (newValue.target.gt(MAX_PERCENT)) revert RebalanceConfigStorageInvalidError();
        if (newValue.threshold.gt(MAX_PERCENT)) revert RebalanceConfigStorageInvalidError();

        uint256 encoded0 =
            uint256(UFixed6.unwrap(newValue.target)    << (256 - 128)) >> (256 - 128) |
            uint256(UFixed6.unwrap(newValue.threshold) << (256 - 128)) >> (256 - 128 - 128);

        assembly {
            sstore(self.slot, encoded0)
        }
    }
}

/// @dev Action message to change configuration for a group of markets
struct RebalanceConfigChange {
    /// @dev Identifies the group to update; set to 0 to create a new group
    uint256 group;
    /// @dev Total collateral to distribute across markets in the group
    UFixed6 totalCollateral;
    /// @dev List of 1-8 markets in which collateral shall be managed.
    /// Markets may be added to or removed from an existing group. Leave empty to delete the group.
    address[] markets;
    /// @dev Target allocation for markets in the aforementioned array
    RebalanceConfig[] configs;
    /// @dev Common information for collateral account actions
    Action action;
}
using RebalanceConfigChangeLib for RebalanceConfigChange global;

/// @title RebalanceConfigChangeLib
/// @notice Library used to hash and verify action to change rebalancing configuration
library RebalanceConfigChangeLib {
    /// @dev used to verify a signed message
    bytes32 constant public STRUCT_HASH = keccak256(
        "RebalanceConfigChange(uint256 group,uint256 totalCollateral,address[] markets,RebalanceConfig[] configs,Action action)"
        "Action(uint256 maxFee,Common common)"
        "Common(address account,address domain,uint256 nonce,uint256 group,uint256 expiry)"
        "RebalanceConfig(uint256 target,uint256 threshold)"
    );

    bytes32 constant public CONFIG_HASH = keccak256(
        "RebalanceConfig(uint256 target,uint256 threshold)"
    );

    /// @dev used to create a signed message
    function hash(RebalanceConfigChange memory self) internal pure returns (bytes32) {
        bytes32[] memory encodedAddresses = new bytes32[](self.markets.length);
        bytes32[] memory encodedConfigs = new bytes32[](self.configs.length);
        for (uint256 i = 0; i < self.markets.length; ++i) {
            encodedAddresses[i] = keccak256(abi.encode(self.markets[i]));
            encodedConfigs[i] = hashConfig(self.configs[i]);
        }
        return keccak256(abi.encode(
            STRUCT_HASH,
            self.group,
            self.totalCollateral,
            keccak256(abi.encodePacked(self.markets)),
            keccak256(abi.encodePacked(encodedConfigs)),
            ActionLib.hash(self.action)
        ));
    }

    // TODO: move to RebalanceConfigLib alongside storage implementation
    function hashConfig(RebalanceConfig memory config) internal pure returns (bytes32) {
        return keccak256(abi.encode(CONFIG_HASH, config.target, config.threshold));
    }
}