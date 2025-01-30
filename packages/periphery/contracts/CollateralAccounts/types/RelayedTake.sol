// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Take, TakeLib } from "@perennial/v2-core/contracts/types/Take.sol";
import { Action, ActionLib } from "./Action.sol";

/// @notice Relays an update to a taker position using a delta
struct RelayedTake {
    /// @dev Message to relay to Market
    Take take;
    /// @dev Common information for relayed actions
    ///      Populate common.domain with the AccountVerifier contract associated with the
    ///      collateral account Controller.
    Action action;
}
using RelayedTakeLib for RelayedTake global;

library RelayedTakeLib {
    /// @dev Used to verify a signed message
    bytes32 constant public STRUCT_HASH = keccak256(
        "RelayedTake(Take take,Action action)"
        "Action(uint256 maxFee,Common common)"
        "Common(address account,address signer,address domain,uint256 nonce,uint256 group,uint256 expiry)"
        "Take(int256 amount,address referrer,Common common)"
    );

    /// @dev Used to create a signed message
    function hash(RelayedTake memory self) internal pure returns (bytes32) {
        return keccak256(abi.encode(STRUCT_HASH, TakeLib.hash(self.take), ActionLib.hash(self.action)));
    }
}
