// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import {IKeeperManager, IMarket, MarketParameter, UFixed6, UFixed6Lib} from "./interfaces/IKeeperManager.sol";
import { Fixed6 } from "@equilibria/root/number/types/Fixed6.sol";

// TODO: if this gets small enough let's roll it into the MultiInvoker file
// TODO: I think a lot of this could be moved into the Order type lib
contract KeeperManager is IKeeperManager {
    /// @dev Maximum number of open orders an account may have per market
    // TODO: perhaps make UOwnable and have this be a param
    uint256 private constant MAX_OPEN_ORDERS = 10;

    /// @dev UID for an order
    uint256 public latestNonce;

    /// @dev Number of open orders an account has per market
    mapping(address => mapping(IMarket => uint256)) public openOrders;

    /// @dev State for the order data
    mapping(address => mapping(IMarket => mapping(uint256 => Order))) public _orders;

    /// @notice View function to get order state
    /// @param account Account to get open oder of
    /// @param market Market to get open order in
    /// @param nonce UID of order
    function orders(address account, IMarket market, uint256 nonce) public view returns (Order memory) {
        return _orders[account][market][nonce]; // TODO: put the getter here for your storage type
    }

    function canExecuteOrder(address account, IMarket market, uint256 nonce) external view returns (bool canFill) {
        Order memory order = _orders[account][market][nonce];
        if(order.execPrice.isZero()) return false;
        (, canFill) = _canFillOrder(order, market);
    }

    /// @notice Places order on behalf of msg.sender from the invoker
    /// @param account Account to place order for
    /// @param market Market to place order in
    /// @param order Order state to place
    function _placeOrder(address account, IMarket market, Order memory order) internal {
        _orders[account][market][++latestNonce] = order;
        if(++openOrders[account][market] > MAX_OPEN_ORDERS) revert KeeperManagerMaxOpenOrdersError();
        emit OrderPlaced(account, market, latestNonce, order);
    }

    /// @notice Cancels an open order for msg.sender
    /// @param account Account to cancel order for
    /// @param market Market order is open in @todo do we need this because of nonce?
    /// @param nonce UID of order
    function _cancelOrder(address account, IMarket market, uint256 nonce) internal {
        // @kevin doesnt save any gas for edge cases in retrospect just uses more for normal cancellations
        if (_orders[account][market][nonce].execPrice.isZero()) return; // TODO: why?
        delete _orders[account][market][nonce];
        --openOrders[account][market];
        emit OrderCancelled(account, market, nonce);
    }

    /// @notice executes an open order for an account
    /// @param account Account to execute order for
    /// @param market Market to execute order in
    /// @param nonce UID of order
    function _executeOrder(
        address account,
        IMarket market,
        uint256 nonce
    ) internal {
        Order memory order = _orders[account][market][nonce];

        if(order.execPrice.isZero()) revert KeeperManagerOrderAlreadyCancelledError();

        (UFixed6 price, bool canFill) = _canFillOrder(order, market);
        if(!canFill) revert KeeperManagerBadCloseError();

        --openOrders[account][market];
        delete _orders[account][market][nonce]; //TODO: storage lib here

        emit OrderExecuted(account, market, nonce,
            price // TODO: this isn't the settlement price so it might not be useful
            // TODO: I think a better thing to track would be the position id of the placed update
        );
    }


    /// @notice Helper function to determine fill eligibility of order
    /// @param order Order to check
    /// @param market Market to get price of
    /// @return price Exec price of order for event context
    /// @return canFill Can fill the order
    function _canFillOrder(Order memory order, IMarket market) internal view returns (UFixed6 price, bool canFill) {
        price = _getMarketPrice(market);

        // TODO: can condense this to a single comparison of the sign of order.execPrice and price.sub(order.execPrice)
        canFill = order.execPrice.sign() == 1 ? price.lte(order.execPrice.abs()) : price.gte(order.execPrice.abs());
    }

    /// @notice Helper function to get price of `market`
    /// @param market Market to get price of
    /// @return price 6-decimal price of market
    function _getMarketPrice(IMarket market) internal view returns (UFixed6 price) {
        // @kevin is this depending on payoff? i guess on the ui it would be flipped and sign made positive?
        // TODO: how are you encoding execution price? prices can actually be negative in the core protocol
        // TODO: need to override with the market's latestPrice, latest can actually be invalid with a totally wrong price
        price = UFixed6Lib.from(market.oracle().latest().price);
    }

}
