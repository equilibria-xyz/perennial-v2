// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import {IKeeperManager, IMarket, MarketParameter, UFixed6, UFixed6Lib} from "./interfaces/IKeeperManager.sol";
import { Fixed6 } from "@equilibria/root/number/types/Fixed6.sol";
import "hardhat/console.sol";

contract KeeperManager is IKeeperManager {

    /// @dev Maximum number of open orders an acccount may have per market
    uint256 private constant MAX_OPEN_ORDERS = 10;

    /// @dev UID for an order
    uint256 public orderNonce;

    /// @dev Number of open orders an accoutn has per market
    mapping(address => mapping(address => uint256)) public numOpenOrders;

    // @todo is keccak256(abi.encode(account, market, nonce)) under the hood worth it for the readability?
    /// @dev State for the order data
    mapping(address => mapping(address => mapping(uint256 => Order))) public allOpenOrders;

    /// @notice View function to get order state
    /// @param account Account to get open oder of
    /// @param market Market to get open order in
    /// @param nonce UID of order
    function readOrder(address account, address market, uint256 nonce) external view returns(Order memory) {
        return _readOrder(account, market, nonce);
    }

    function canExecuteOrder(address account, address market, uint256 nonce) external view returns(bool) {
        Order memory o = _readOrder(account, market, nonce);
        if(o.execPrice.isZero()) return false;

        (, bool canFill) = _canFillOrder(o, market);
        return canFill;
    }

    /// @notice Places order on behalf of `account` from the invoker
    /// @param account Account to place order for
    /// @param market Market to place order in
    /// @param order Order state to place
    function _placeOrder(
        address account,
        address market,
        Order memory order
    ) internal {

        uint256 _orderNonce = ++orderNonce;
       //  ++orderNonce;
        allOpenOrders[account][market][orderNonce] = order;

        ++numOpenOrders[account][market];

        uint256 _openOrders = numOpenOrders[account][market];
        if(_openOrders > MAX_OPEN_ORDERS) revert KeeperManagerMaxOpenOrdersError();

        emit OrderPlaced(
            account,
            market,
            _orderNonce,
            _openOrders,
            order.execPrice,
            order.maxFee);
    }

    /// @notice Cancels an open order for msg.sender
    /// @param market Market order is open in @todo do we need this because of nonce?
    /// @param nonce UID of order
    function _cancelOrder(
        address market,
        uint256 nonce
    ) internal {
        Order memory order = _readOrder(msg.sender, market, nonce);

        if(order.execPrice.isZero()) return;

        delete allOpenOrders[msg.sender][market][nonce];
        --numOpenOrders[msg.sender][market];

        emit OrderCancelled(
            msg.sender,
            market,
            nonce);
    }

    /// @notice executes an open order for an account 
    /// @param account Accoubnt to execute order for 
    /// @param market Market to execute order in @todo do we need this bc of nonce? 
    /// @param nonce UID of order
    function _executeOrder(
        address account,
        address market,
        uint256 nonce
    ) internal {
        Order memory order = _readOrder(account, market, nonce);

        if(order.execPrice.isZero()) revert KeeperManagerOrderAlreadyCancelledError();

        (UFixed6 mktPrice, bool canFill) = _canFillOrder(order, market);
        if(!canFill) revert KeeperManagerBadCloseError();

        --numOpenOrders[account][market];
        delete allOpenOrders[account][market][nonce];

        emit OrderExecuted(
            account,
            market,
            nonce,
            mktPrice,
            order.execPrice);
    }

    /// @notice Helper function to determnine fill elligibility of order
    /// @param o Order to check
    /// @param market Market to get price of
    /// @return UFixed6 Exec price of order for event context
    /// @return bool Can fill the order
    function _canFillOrder(Order memory o, address market) internal view returns (UFixed6, bool) {
        UFixed6 price = _getMarketPrice(market);
        bool canFill;

        bool priceAtOrBelow = price.lte(o.execPrice.abs());
        bool priceAtOrAbove = price.gte(o.execPrice.abs());

        canFill = o.execPrice.sign() == 1 ?
            priceAtOrBelow :
            priceAtOrAbove ;

        return (price, canFill);
    }

    /// @notice Helper function for reading order state /// @todo storage lib?
    function _readOrder(address account, address market, uint256 nonce) internal view returns (Order memory order) {
        order = allOpenOrders[account][market][nonce];
    }

    /// @notice Helper function to get price of `market`
    /// @param market Market to get price of
    /// @return price 6-deciaml price of market
    function _getMarketPrice(address market) internal view returns (UFixed6 price) {
        // @todo safe type conversion?
        price = UFixed6Lib.from(IMarket(market).oracle().latest().price);
    }

}
