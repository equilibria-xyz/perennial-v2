// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Common, CommonLib } from "@equilibria/root/verifier/types/Common.sol";
import { IMarket } from "@equilibria/perennial-v2/contracts/interfaces/IMarket.sol";

struct CancelOrderAction {
    /// @dev Identifies the market in which user wants to cancel their order
    IMarket market;
    /// @dev Same as TriggerOrderAction; set nonce to the order to cancel
    Common common;
}