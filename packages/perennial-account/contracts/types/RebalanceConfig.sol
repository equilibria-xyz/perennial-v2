// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";

/// @dev Rebalancing configuration for a single market
struct RebalanceConfig {
    /// @dev Percentage of collateral from the group to deposit into the market
    UFixed6 target;
    /// @dev Ratio of market collateral to target after which keepers may rebalance
    UFixed6 threshold;
}

struct RebalanceConfigStorage { uint256 slot0; }
using RebalanceConfigLib for RebalanceConfigStorage global;

/// @title RebalanceConfigLib
/// @notice Library used to hash and manage storage for rebalancing configuration for a single market
library RebalanceConfigLib {
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
        if (newValue.target.gt(UFixed6Lib.ONE)) revert RebalanceConfigStorageInvalidError();
        if (newValue.threshold.gt(UFixed6Lib.ONE)) revert RebalanceConfigStorageInvalidError();

        uint256 encoded0 =
            uint256(UFixed6.unwrap(newValue.target)    << (256 - 32)) >> (256 - 32) |
            uint256(UFixed6.unwrap(newValue.threshold) << (256 - 32)) >> (256 - 32 - 32);

        assembly {
            sstore(self.slot, encoded0)
        }
    }
}
