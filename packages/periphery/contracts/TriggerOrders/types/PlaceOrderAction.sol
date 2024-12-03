// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Common, CommonLib } from "@equilibria/root/verifier/types/Common.sol";
import { IMarket } from "@perennial/v2-core/contracts/interfaces/IMarket.sol";

import { Action, ActionLib } from "./Action.sol";
import { TriggerOrder, TriggerOrderStorageLib } from "./TriggerOrder.sol";

/// @notice Request to persist a new trigger order or replace an open trigger order
struct PlaceOrderAction {
    /// @dev Conveys the desired change in position and conditions to make the change
    TriggerOrder order;
    /// @dev Information shared across all EIP712 actions;
    ///      action.market         - market in which user's position should be changed
    ///      action.orderId        - per-user unique order identifier
    ///      action.maxFee         - maximum amount to compensate keeper
    ///      action.common.account - user participating in the market
    ///      action.common.signer  - user or delegate signing the transaction
    ///      action.common.domain  - Manager contract verifying the request
    ///      action.common.nonce   - per-user unique message identifier
    ///      action.common.group   - may be used to cancel multiple pending orders which have not been persisted
    ///      action.common.expiry  - order will be implictly cancelled if not persisted after this time
    Action action;
}
using PlaceOrderActionLib for PlaceOrderAction global;

/// @notice Library used to hash new trigger order requests
library PlaceOrderActionLib {
    /// @dev Used to verify a signed message
    bytes32 constant public STRUCT_HASH = keccak256(
        "PlaceOrderAction(TriggerOrder order,Action action)"
        "Action(address market,uint256 orderId,uint256 maxFee,Common common)"
        "Common(address account,address signer,address domain,uint256 nonce,uint256 group,uint256 expiry)"
        "InterfaceFee(uint64 amount,address receiver,bool fixedFee,bool unwrap)"
        "TriggerOrder(uint8 side,int8 comparison,int64 price,int64 delta,uint64 maxFee,bool isSpent,address referrer,InterfaceFee interfaceFee)"
    );

    /// @dev Used to create a signed message
    function hash(PlaceOrderAction memory self) internal pure returns (bytes32) {
        return keccak256(abi.encode(STRUCT_HASH, TriggerOrderStorageLib.hash(self.order), ActionLib.hash(self.action)));
    }
}
