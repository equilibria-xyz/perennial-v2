// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import {IKeeperManager, IMarket, MarketParameter, UFixed6, UFixed6Lib} from "./interfaces/IKeeperManager.sol";
import { Fixed6 } from "@equilibria/root/number/types/Fixed6.sol";

import "hardhat/console.sol";

// TODO: if this gets small enough let's roll it into the MultiInvoker file
// TODO: I think a lot of this could be moved into the Order type lib
contract KeeperManager is IKeeperManager {
    /// @dev Maximum number of open orders an account may have per market
    // TODO: perhaps make UOwnable and have this be a param
    // TODO: maybe get rid of this
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
        return _orders[account][market][nonce]; // TODO: storage lib getter
    }

    function canExecuteOrder(address account, IMarket market, uint256 nonce) external view returns (bool canFill) {
        Order memory order = orders(account, market, nonce); // TODO: storage lib getter
        if(order.execPrice.isZero()) return false;
        return _canFillOrder(order, market);
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
    /// @param market Market order is open in
    /// @param nonce UID of order
    function _cancelOrder(address account, IMarket market, uint256 nonce) internal {
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
        uint256 nonce,
        uint256 positionId
    ) internal {
        Order memory order = _orders[account][market][nonce];

        if(order.execPrice.isZero()) revert KeeperManagerOrderAlreadyCancelledError();

        bool canFill = _canFillOrder(order, market);
        if(!canFill) revert KeeperManagerBadCloseError();

        --openOrders[account][market];
        delete _orders[account][market][nonce]; //TODO: storage lib here

        emit OrderExecuted(account, market, nonce, positionId);
    }

    function _canFillOrder(Order memory order, IMarket market) internal view returns (bool canFill) {
        Fixed6 price = _getMarketPrice(market);

        canFill = order.priceBelow ? price.lte(order.execPrice) : price.gte(order.execPrice);
    }

    /// @notice Helper function to get price of `market`
    /// @param market Market to get price of
    /// @return price 6-decimal price of market
    function _getMarketPrice(IMarket market) internal view returns (Fixed6 price) {
        // @kevin is this depending on payoff? i guess on the ui it would be flipped and sign made positive?
        // TODO: how are you encoding execution price? prices can actually be negative in the core protocol
        // TODO: need to override with the market's latestPrice, latest can actually be invalid with a totally wrong price
        price = market.oracle().latest().price;
    }
}