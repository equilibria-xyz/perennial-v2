// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Common, CommonLib } from "@equilibria/root/verifier/types/Common.sol";
import { IMarket } from "@equilibria/perennial-v2/contracts/interfaces/IMarket.sol";
import { TriggerOrder } from "./TriggerOrder.sol";

/// @notice Request to persist a new trigger order
struct TriggerOrderAction {
    /// @dev Identifies the market in which user wants to change their position
    IMarket market;
    /// @dev Conveys the desired change in position and conditions to make the change
    TriggerOrder order;
    /// @dev Information shared across all EIP712 actions;
    ///      common.account - the user participating in the market
    ///      common.signer  - the user or delegate signing the transaction
    ///      common.domain  - the Manager contract verifying the request
    ///      common.nonce   - per-user unique order identifier
    ///      common.group   - may be used to cancel multiple pending orders which have not been persisted
    ///      common.expiry  - order will be implictly cancelled if not persisted after this time
    Common common;
}
// using TriggerOrderActionLib for TriggerOrderAction global;
