// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { IMarket } from "@perennial/v2-core/contracts/interfaces/IMarket.sol";

import { CancelOrderAction } from "../types/CancelOrderAction.sol";
import { InterfaceFee } from "../types/InterfaceFee.sol";
import { PlaceOrderAction, TriggerOrder } from "../types/PlaceOrderAction.sol";

/// @notice Stores and executes trigger orders
interface IManager {
    /// @notice Emitted when a trigger order is written to storage, whether as a new order or a replacement
    /// @param market Perennial market for which the order is intended
    /// @param account Actor who wants to change their position in the market
    /// @param order Desired change in position and conditions upon which change may be made
    /// @param orderId Client-supplied order identifier, unique to client
    event TriggerOrderPlaced(
        IMarket indexed market,
        address indexed account,
        TriggerOrder order,
        uint256 orderId
    );

    /// @notice Emitted when an order has been cancelled
    /// @param market Perennial market for which the order was intended
    /// @param account Actor whose order was cancelled
    /// @param orderId Uniquely identifies the cancelled order
    event TriggerOrderCancelled(IMarket indexed market, address indexed account, uint256 orderId);

    /// @notice Emitted when a trigger orders conditions have been met and the user's position has been updated
    /// @param market Perennial market which the order affected
    /// @param account Actor whose position was changed
    /// @param order Change in position and conditions which were satisfied
    /// @param orderId Uniquely identifies the executed order
    event TriggerOrderExecuted(IMarket indexed market, address indexed account, TriggerOrder order, uint256 orderId);

    /// @notice Emitted when an interface fee specified on a trigger order has been paid
    /// @param account Actor who paid the fee
    /// @param market Perennial market from which the fee was pulled
    /// @param fee Details including the fee amount and recipient of the fee
    event TriggerOrderInterfaceFeeCharged(address indexed account, IMarket indexed market, InterfaceFee fee);

    // sig: 0x955cc4b9
    /// @custom:error Order does not exist or was already cancelled or executed
    error ManagerCannotCancelError();

    // sig: 0x8013a216
    /// @custom:error Conditions required for order execution are not currently met
    error ManagerCannotExecuteError();

    // sig: 0x170dda16
    /// @custom:error Replacement order may not reduce maxFee; must cancel and resubmit with new orderId
    error ManagerCannotReduceMaxFee();

    // sig: 0xd0cfc108
    /// @custom:error Order nonce has already been used
    error ManagerInvalidOrderNonceError();

    // sig: 0x6673613b
    /// @custom:error Signer is not authorized to interact with markets for the specified user
    error ManagerInvalidSignerError();

    // sig: 0x13722df5
    /// @custom:error Operator is not authorized to interact with markets for the specified user
    error ManagerNotOperatorError();

    /// @notice Store a new trigger order or replace an existing trigger order
    /// @param market Perennial market in which user wants to change their position
    /// @param orderId Client-specific order identifier
    /// @param order Desired change in position and conditions upon which change may be made
    function placeOrder(IMarket market, uint256 orderId, TriggerOrder calldata order) external;

    /// @notice Called by keeper to store a new or replace an existing trigger order via a signed message
    /// @param request Message containing the market, order, and nonce used to uniquely identify the user's order.
    /// @param signature EIP712 message signature
    function placeOrderWithSignature(PlaceOrderAction calldata request, bytes calldata signature) external;

    /// @notice Cancels a trigger order
    /// @param market Perennial market for which the order was submitted
    /// @param orderId Uniquely identifies the order to cancel
    function cancelOrder(IMarket market, uint256 orderId) external;

    /// @notice Called by keeper to cancel a trigger order via a signed message
    /// @param request Message containing the market, order, and nonce used to uniquely identify the order to cancel
    /// @param signature EIP712 message signature
    function cancelOrderWithSignature(CancelOrderAction calldata request, bytes calldata signature) external;

    /// @notice Retrieves an unexecuted trigger order
    /// @param market Perennial market for which the order was submitted
    /// @param account User for whom the order was submitted
    /// @param orderId Uniquely identifies the order for a user
    function orders(IMarket market, address account, uint256 orderId) external view returns (TriggerOrder memory);

    /// @notice Determines whether trigger conditions for an order have been met
    /// @param market Perennial market for which the order is intended
    /// @param account Actor whose position is to be changed
    /// @param orderId Uniquely identifies the order for an account
    /// @return order Trigger order read from storage
    /// @return canExecute True if trigger conditions have been met and executeOrder may be called on the order
    function checkOrder(
        IMarket market,
        address account,
        uint256 orderId
    ) external returns (TriggerOrder memory order, bool canExecute);

    /// @notice Called by keeper to execute an order whose trigger conditions have been met
    /// @param market Perennial market for which the order is intended
    /// @param account Actor whose position is to be changed
    /// @param orderId Uniquely identifies the order for an account
    function executeOrder(IMarket market, address account, uint256 orderId) external;

    /// @notice withdraw DSU or unwrap DSU to withdraw USDC from this address to `account`
    /// @param account Account to claim fees for
    /// @param unwrap Wheather to wrap/unwrap collateral on withdrawal
    function claim(address account, bool unwrap) external;
}
