// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Common, CommonLib } from "@equilibria/root/verifier/types/Common.sol";
import { IMarket } from "@perennial/v2-core/contracts/interfaces/IMarket.sol";
import { Action, ActionLib } from "./Action.sol";

/// @notice Request to cancel a persisted ("placed") order
struct CancelOrderAction {
    /// @dev Identifies the order to cancel
    ///      action.market         - market for which order was placed
    ///      action.orderId     - order identifier assigned by the user
    ///      action.maxFee         - maximum amount to compensate keeper
    ///      action.common.account - the user who submitted the order
    Action action;
}
using CancelOrderActionLib for CancelOrderAction global;

/// @notice Library used to hash requests to cancel an existing order
library CancelOrderActionLib {
    /// @dev Used to verify a signed message
    bytes32 constant public STRUCT_HASH = keccak256(
        "CancelOrderAction(Action action)"
        "Action(address market,uint256 orderId,uint256 maxFee,Common common)"
        "Common(address account,address signer,address domain,uint256 nonce,uint256 group,uint256 expiry)"
    );

    /// @dev Used to create a signed message
    function hash(CancelOrderAction memory self) internal pure returns (bytes32) {
        return keccak256(abi.encode(STRUCT_HASH, ActionLib.hash(self.action)));
    }
}
