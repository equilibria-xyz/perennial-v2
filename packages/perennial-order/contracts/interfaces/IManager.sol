// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { IMarket } from "@equilibria/perennial-v2/contracts/interfaces/IMarket.sol";

import { CancelOrderAction } from "../types/CancelOrderAction.sol";
import { PlaceOrderAction, TriggerOrder} from "../types/PlaceOrderAction.sol";

/// @notice Stores and executes trigger orders
interface IManager {
    /// @notice Emitted when a trigger order is written to storage, whether as a new order or a replacement
    /// @param market Perennial market for which the order is intended
    /// @param user Actor who wants to change their position in the market
    /// @param order Desired change in position and conditions upon which change may be made
    /// @param orderNonce Client-supplied order identifier, unique to client
    event OrderPlaced(
        IMarket indexed market,
        address indexed user,
        TriggerOrder order,
        uint256 orderNonce
    );

    /// @notice Emitted when an order has been cancelled
    /// @param market Perennial market for which the order was intended
    /// @param user Actor whose order was cancelled
    /// @param orderId Uniquely identifies the cancelled order
    event OrderCancelled(IMarket indexed market, address indexed user, uint256 orderId);

    /// @notice Emitted when a trigger orders conditions have been met and the user's position has been updated
    /// @param market Perennial market which the order affected
    /// @param user Actor whose position was changed
    /// @param order Change in position and conditions which were satisfied
    /// @param orderId Uniquely identifies the executed order
    event OrderExecuted(IMarket indexed market, address indexed user, TriggerOrder order, uint256 orderId);

    // sig: 0xd0cfc108
    /// @custom:error Order nonce has already been used
    error ManagerInvalidOrderNonceError();

    /// @notice Store a new trigger order or replace an existing trigger order
    /// @param market Perennial market in which user wants to change their position
    /// @param orderNonce Client-specific order identifier
    /// @param order Desired change in position and conditions upon which change may be made
    function placeOrder(IMarket market, uint256 orderNonce, TriggerOrder calldata order) external;

    /// @notice Store a new or replace an existing trigger order via a signed message
    /// @param action Message containing the market, order, and nonce used to uniquely identify the user's order.
    /// @param signature EIP712 message signature
    function placeOrderWithSignature(PlaceOrderAction calldata action, bytes calldata signature) external;

    /// @notice Cancels a trigger order
    /// @param market Perennial market for which the order was submitted
    /// @param orderNonce Uniquely identifies the order to cancel
    function cancelOrder(IMarket market, uint256 orderNonce) external;

    /// @notice Cancels a trigger order via a signed message
    /// @param action Message containing the market, order, and nonce used to uniquely identify the order to cancel
    /// @param signature EIP712 message signature
    function cancelOrderWithSignature(CancelOrderAction calldata action, bytes calldata signature) external;

    /// @notice Retrieves an unexecuted trigger order
    /// @param market Perennial market for which the order was submitted
    /// @param account User for whom the order was submitted
    /// @param nonce Uniquely identifies the order for a user
    function orders(IMarket market, address account, uint256 nonce) external view returns (TriggerOrder memory);

    /// @notice Determines whether trigger conditions for an order have been met
    /// @param market Perennial market for which the order is intended
    /// @param user Actor whose position is to be changed
    /// @param nonce Uniquely identifies the order for a user
    /// @return canExecute True if trigger conditions have been met and executeOrder may be called on the order
    function checkOrder(IMarket market, address user, uint256 nonce) external returns (bool canExecute);

    /// @notice Called by keeper to execute an order whose trigger conditions have been met
    /// @param market Perennial market for which the order is intended
    /// @param user Actor whose position is to be changed
    /// @param nonce Uniquely identifies the order for a user
    function executeOrder(IMarket market, address user, uint256 nonce) external;
}
