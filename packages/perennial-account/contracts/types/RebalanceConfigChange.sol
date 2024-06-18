// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Action, ActionLib } from "./Action.sol";
import { RebalanceConfig, RebalanceConfigLib } from "./RebalanceConfig.sol";
import { IController } from "../interfaces/IController.sol";


/// @dev Action message to change configuration for a group of markets
struct RebalanceConfigChange {
    /// @dev Identifies which group to change; indexed 1-8
    uint256 group;
    /// @dev List of 1-4 markets in which collateral shall be managed.
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
        "RebalanceConfigChange(uint256 group,address[] markets,RebalanceConfig[] configs,Action action)"
        "Action(uint256 maxFee,Common common)"
        "Common(address account,address signer,address domain,uint256 nonce,uint256 group,uint256 expiry)"
        "RebalanceConfig(uint256 target,uint256 threshold)"
    );

    /// @dev used to create a signed message
    function hash(RebalanceConfigChange memory self) internal pure returns (bytes32) {
        bytes32[] memory encodedAddresses = new bytes32[](self.markets.length);
        bytes32[] memory encodedConfigs = new bytes32[](self.configs.length);

        // ensure consistent error for length mismatch
        if (self.markets.length != self.configs.length)
            revert IController.ControllerInvalidRebalanceConfig();

        for (uint256 i = 0; i < self.markets.length; ++i) {
            encodedAddresses[i] = keccak256(abi.encode(self.markets[i]));
            encodedConfigs[i] = RebalanceConfigLib.hash(self.configs[i]);
        }
        return keccak256(abi.encode(
            STRUCT_HASH,
            self.group,
            keccak256(abi.encodePacked(self.markets)),
            keccak256(abi.encodePacked(encodedConfigs)),
            ActionLib.hash(self.action)
        ));
    }
}
