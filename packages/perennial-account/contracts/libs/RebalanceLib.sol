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

// TODO: Figure out how this will work with upgradable proxies.
/// @dev abstracts away the complexity of collections required to manage Rebalance configuration
struct RebalanceStorage {
    /// @dev Serial identifier for rebalancing groups
    uint256 lastGroupId;

    /// @dev Mapping of rebalance configuration
    /// owner => group => market => config
    mapping(address => mapping(uint256 => mapping(address => RebalanceConfig))) config;

    /// @dev Prevents markets from being added to multiple groups
    /// owner => market => group
    mapping(address => mapping(address => uint256)) marketToGroup;

    /// @dev Prevents users from making up their own group numbers
    /// group => owner
    mapping(uint256 => address) groupToOwner;

    /// @dev Allows iteration through markets in a group
    mapping(uint256 => address[]) groupToMarkets;
}

/// @title RebalanceLib
/// @notice Facilities for interacting with Rebalance configuration
library RebalanceLib {

    // TODO: split this into smaller functions for create and update
    // TODO: check gas passing as memory and having the caller commit everything
    function changeConfig(
        RebalanceStorage storage self,
        RebalanceConfigChange calldata message) external /*returns (RebalanceStorage memory self)*/ {
        // sum of the target allocations of all markets in the group
        UFixed6 totalAllocation;
        // put this on the stack for readability
        address owner = message.action.common.account;

        // create a new group
        if (message.group == 0) {
            self.lastGroupId++;
            for (uint256 i; i < message.markets.length; ++i)
            {
                // ensure market isn't already pointing to a group
                uint256 currentGroup = self.marketToGroup[owner][message.markets[i]];
                if (currentGroup != 0)
                    revert IController.ControllerMarketAlreadyInGroup(message.markets[i], currentGroup);

                // update state
                self.groupToOwner[self.lastGroupId] = owner;
                self.marketToGroup[owner][message.markets[i]] = self.lastGroupId;
                self.config[owner][self.lastGroupId][message.markets[i]] = message.configs[i];
                self.groupToMarkets[self.lastGroupId].push(message.markets[i]);

                // Ensure target allocation across all markets totals 100%.
                totalAllocation = totalAllocation.add(message.configs[i].target);

                emit IController.RebalanceMarketConfigured(
                    owner,
                    self.lastGroupId,
                    message.markets[i],
                    message.configs[i]
                );
            }
            emit IController.RebalanceGroupConfigured(owner, self.lastGroupId, message.markets.length);

        // update an existing group
        } else {
            // ensure this group was created for the owner, preventing user from assigning their own number
            if (self.groupToOwner[message.group] != owner)
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

        // if not deleting the group, ensure rebalance targets add to 100%
        if (message.markets.length != 0 && !totalAllocation.eq(RebalanceConfigLib.MAX_PERCENT))
            revert IController.ControllerInvalidRebalanceTargets();
    }
}