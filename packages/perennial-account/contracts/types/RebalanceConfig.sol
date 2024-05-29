// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { UFixed6 } from "@equilibria/root/number/types/UFixed6.sol";
import { Action, ActionLib } from "./Action.sol";

/// TODO: these don't need all 256 bits; should fit within a single storage slot
struct RebalanceConfig {
    /// @dev below this collateralization, keepers may add collateral
    UFixed6 minCollateralization;
    /// @dev above this collateralization, keepers may remove collateral
    UFixed6 maxCollateralization;
}

struct RebalanceConfigChange {
    address[] markets;
    RebalanceConfig[] configs;
    Action action;
}
using RebalanceConfigChangeLib for RebalanceConfigChange global;

/// @title RebalanceConfigChangeLib
/// @notice Library used to hash and verify action to change rebalancing configuration
library RebalanceConfigChangeLib {
    /// @dev used to verify a signed message
    bytes32 constant public STRUCT_HASH = keccak256(
        "RebalanceConfigChange(address[] markets,RebalanceConfig[] configs,Action action)"
        "Action(uint256 maxFee,Common common)"
        "Common(address account,address domain,uint256 nonce,uint256 group,uint256 expiry)"
        "RebalanceConfig(uint256 minCollateralization,uint256 maxCollateralization)"
    );

    bytes32 constant public CONFIG_HASH = keccak256(
        "RebalanceConfig(uint256 minCollateralization,uint256 maxCollateralization)"
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
            keccak256(abi.encodePacked(self.markets)),
            keccak256(abi.encodePacked(encodedConfigs)),
            ActionLib.hash(self.action)
        ));
    }

    // TODO: move to RebalanceConfigLib alongside storage implementation
    function hashConfig(RebalanceConfig memory config) internal pure returns (bytes32) {
        return keccak256(abi.encode(CONFIG_HASH, config.minCollateralization, config.maxCollateralization));
    }
}