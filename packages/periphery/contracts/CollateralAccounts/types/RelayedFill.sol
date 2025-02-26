// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Fill, FillLib } from "@perennial/v2-core/contracts/types/Fill.sol";
import { Action, ActionLib } from "./Action.sol";

/// @notice Relays a update to fill an intent to Market
struct RelayedFill {
    /// @dev Message to fill an intent to Market
    Fill fill;
    /// @dev Common information for relayed actions
    ///      Populate common.domain with the AccountVerifier contract associated with the
    ///      collateral account Controller.
    Action action;
}
using RelayedFillLib for RelayedFill global;

library RelayedFillLib {
    /// @dev Used to verify a signed message
    bytes32 constant public STRUCT_HASH = keccak256(
        "RelayedFill(Fill fill,Action action)"
        "Action(uint256 maxFee,Common common)"
        "Common(address account,address signer,address domain,uint256 nonce,uint256 group,uint256 expiry)"
        "Fill(Intent intent,Common common)"
        "Intent(int256 amount,int256 price,uint256 fee,address originator,address solver,uint256 collateralization,Common common)"
    );

    /// @dev Used to create a signed message
    function hash(RelayedFill memory self) internal pure returns (bytes32) {
        return keccak256(abi.encode(STRUCT_HASH, FillLib.hash(self.fill), ActionLib.hash(self.action)));
    }
}
