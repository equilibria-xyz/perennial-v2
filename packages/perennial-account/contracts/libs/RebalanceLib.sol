// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { UFixed6 } from "@equilibria/root/number/types/UFixed6.sol";
import { IController } from "../interfaces/IController.sol";
import {
    RebalanceConfig,
    RebalanceConfigLib,
    RebalanceConfigChange,
    RebalanceConfigChangeLib
} from "../types/RebalanceConfig.sol";

// TODO: move these collections back into Controller and eliminate this struct
// TODO: uint256 could be shortened to uint8
/// @dev abstracts away the complexity of collections required to manage Rebalance configuration
struct RebalanceStorage {
    /// @dev Mapping of rebalance configuration
    /// owner => group => market => config
    mapping(address => mapping(uint256 => mapping(address => RebalanceConfig))) config;

    /// @dev Prevents markets from being added to multiple groups
    /// owner => market => group
    mapping(address => mapping(address => uint256)) marketToGroup;

    /// @dev Allows iteration through markets in a group
    mapping(uint256 => address[]) groupToMarkets;
}


/// @title RebalanceLib
/// @notice Facilities for interacting with Rebalance configuration
library RebalanceLib {
    uint256 constant MAX_GROUPS_PER_OWNER = 8;
    // TODO: limit the number of markets in a group
    uint256 constant MAX_MARKETS_PER_GROUP = 4;

    /// @notice Creates a new rebalance group or updates/deletes an existing rebalance group
    /// @param self Instance of rebalance storage
    /// @param message User request to create/update/delete
    function changeConfig(
        RebalanceStorage storage self,
        RebalanceConfigChange calldata message) external {
        // sum of the target allocations of all markets in the group
        UFixed6 totalAllocation;
        // put this on the stack for readability
        address owner = message.action.common.account;

        totalAllocation = updateGroup(self, message, owner);

        // if not deleting the group, ensure rebalance targets add to 100%
        if (message.markets.length != 0 && !totalAllocation.eq(RebalanceConfigLib.MAX_PERCENT))
            revert IController.ControllerInvalidRebalanceTargets();
    }

    function updateGroup(
        RebalanceStorage storage self,
        RebalanceConfigChange calldata message,
        address owner
    ) private returns (UFixed6 totalAllocation) {
        // ensure group index is valid
        if (message.group == 0 || message.group > MAX_GROUPS_PER_OWNER)
            revert IController.ControllerInvalidRebalanceGroup();

        // delete the existing group
        for (uint256 i; i < self.groupToMarkets[message.group].length; ++i) {
            address market = self.groupToMarkets[message.group][i];
            delete self.config[owner][message.group][market];
            delete self.marketToGroup[owner][market];
        }
        delete self.groupToMarkets[message.group];

        for (uint256 i; i < message.markets.length; ++i) {
            // ensure market is not pointing to a different group
            uint256 currentGroup = self.marketToGroup[owner][message.markets[i]];
            if (currentGroup != 0)
                revert IController.ControllerMarketAlreadyInGroup(message.markets[i], currentGroup);

            // rewrite over all the old configuration
            self.marketToGroup[owner][message.markets[i]] = message.group;
            self.config[owner][message.group][message.markets[i]] = message.configs[i];
            self.groupToMarkets[message.group].push(message.markets[i]);

            // ensure target allocation across all markets totals 100%
            // read from storage to trap duplicate markets in the message
            totalAllocation = totalAllocation.add(
                self.config[owner][message.group][message.markets[i]].target
            );

            emit IController.RebalanceMarketConfigured(
                owner,
                message.group,
                message.markets[i],
                message.configs[i]
            );
        }

        emit IController.RebalanceGroupConfigured(owner, message.group, message.markets.length);
    }
}