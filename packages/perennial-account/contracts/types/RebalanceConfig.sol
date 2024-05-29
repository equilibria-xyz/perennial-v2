// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { UFixed6 } from "@equilibria/root/number/types/UFixed6.sol";
import { Action, ActionLib } from "./Action.sol";

/// TODO: these don't need all 256 bits; should fit within a single storage slot
struct RebalanceConfig {
    /// @dev Percentage of collateral from the group to deposit into the market
    UFixed6 target;
    /// @dev Percentage away from the target at which keepers may rebalance
    UFixed6 threshold;
}

struct RebalanceConfigChange {
    /// @dev Identifies the group to update; set to 0 to create a new group
    uint256 group;
    /// @dev Total collateral to distribute across markets in the group
    UFixed6 totalCollateral;
    /// @dev List of markets in which collateral shall be managed
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