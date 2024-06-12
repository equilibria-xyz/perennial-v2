// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { UFixed6 } from "@equilibria/root/number/types/UFixed6.sol";
import { Action, ActionLib } from "./Action.sol";
import { IController } from "../interfaces/IController.sol";

/// @dev Rebalancing configuration for a single market
struct RebalanceConfig {
    /// @dev Percentage of collateral from the group to deposit into the market
    UFixed6 target;
    /// @dev Percentage away from the target at which keepers may rebalance
    UFixed6 threshold;
}
// FIXME: Naming is pretty confusing here; maybe the struct above should be RebalanceMarketConfig and
// this could be renamed RebalanceMarketConfigStorage and the library RebalanceMarketConfigLib
struct RebalanceConfigStorage { uint256 slot0; }
using RebalanceConfigLib for RebalanceConfigStorage global;

/// @title RebalanceConfigLib
/// @notice Library used to hash and manage storage for rebalancing configuration for a single market
library RebalanceConfigLib {
    UFixed6 constant public MAX_PERCENT = UFixed6.wrap(1e6); // 100%

    bytes32 constant public STRUCT_HASH = keccak256(
        "RebalanceConfig(uint256 target,uint256 threshold)"
    );

    /// sig: 0xd673935e
    error RebalanceConfigStorageInvalidError();

    /// @dev hashes this instance for inclusion in an EIP-712 message
    function hash(RebalanceConfig memory self) internal pure returns (bytes32) {
        return keccak256(abi.encode(STRUCT_HASH, self.target, self.threshold));
    }

    /// @dev extracts two unsigned values from a single storage slot
    function read(RebalanceConfigStorage storage self) internal view returns (RebalanceConfig memory) {
        uint256 slot0 = self.slot0;
        return RebalanceConfig(
            UFixed6.wrap(uint256(slot0 << (256 - 32)) >> (256 - 32)),
            UFixed6.wrap(uint256(slot0 << (256 - 32 - 32)) >> (256 - 32))
        );
    }

    /// @dev ensures values do not exceed 100% and writes them to a single storage slot
    function store(RebalanceConfigStorage storage self, RebalanceConfig memory newValue) external {
        if (newValue.target.gt(MAX_PERCENT)) revert RebalanceConfigStorageInvalidError();
        if (newValue.threshold.gt(MAX_PERCENT)) revert RebalanceConfigStorageInvalidError();

        uint256 encoded0 =
            uint256(UFixed6.unwrap(newValue.target)    << (256 - 32)) >> (256 - 32) |
            uint256(UFixed6.unwrap(newValue.threshold) << (256 - 32)) >> (256 - 32 - 32);

        assembly {
            sstore(self.slot, encoded0)
        }
    }
}

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