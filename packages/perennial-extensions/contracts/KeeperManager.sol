pragma solidity ^0.8.13;

import {IMultiInvoker } from "./interfaces/IMultiInvoker.sol";
import {IKeeperManager, IMarket, MarketParameter, UFixed6, UFixed6Lib} from "./interfaces/IKeeperManager.sol";


import { Fixed6 } from "@equilibria/root-v2/contracts/Fixed6.sol";

contract KeeperManager is IKeeperManager {

    // auth state
    IMultiInvoker public invoker;

    // order state
    uint256 public orderNonce;
    mapping(address => mapping(address=> uint8)) public numOpenOrders;
    mapping(address => mapping(address => mapping(uint256 => Order))) public allOpenOrders;

    uint8 public constant MAX_PCT = 100;

    constructor(address invoker_) {
        invoker = IMultiInvoker(invoker_);
    }

    modifier onlyInvoker() {
        if (msg.sender != address(invoker)) revert KeeeperManager_NotOnlyInvoker();  
        _;
    }

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
    function placeOrder(
        address account, 
        address market, 
        Order memory order
    ) external onlyInvoker {
        
        uint256 _orderNonce = ++orderNonce;
        //++orderNonce;
        allOpenOrders[account][market][orderNonce] = order;

        ++numOpenOrders[account][market];
        
        uint8 _openOrders = numOpenOrders[account][market];
        if(_openOrders > 10) revert KeeperManager_PlaceOrder_MaxOpenOrders();
        
        emit OrderPlaced(
            account, 
            market,
            _orderNonce,
            _openOrders,
            order.execPrice,
            order.maxFee); 
    }

    /// @notice Update order invoker action to change exec price and or max fee.
    function updateOrder(
        address account,
        address market,
        uint256 nonce,
        Order memory update
    ) external onlyInvoker {
        Order memory openOrder = _readOrder(account, market, nonce);

        if(openOrder.execPrice.isZero()) revert KeeperManager_UpdateOrder_OrderDoesNotExist();

        
        openOrder.execPrice = update.execPrice.isZero() ? openOrder.execPrice : update.execPrice;
        openOrder.maxFee = update.maxFee.isZero() ? openOrder.maxFee : update.maxFee;
        openOrder.size = openOrder.isLimit && !update.size.isZero() ? update.size : openOrder.size;

        allOpenOrders[account][market][nonce] = openOrder;

        emit OrderUpdated(
            account, 
            market, 
            nonce, 
            openOrder.execPrice,
            openOrder.maxFee);
    }

    function cancelOrder(
        address account,
        address market,
        uint256 nonce
    ) external onlyInvoker {
        Order memory order = _readOrder(account, market, nonce);

        if(order.execPrice.isZero()) return;

        delete allOpenOrders[account][market][nonce];
        --numOpenOrders[account][market];

        emit OrderCancelled(
            account,
            market,
            nonce);
    }

    function executeOrder(
        address account,
        address market,
        uint256 nonce
    ) external onlyInvoker {
        Order memory order = _readOrder(account, market, nonce);

        if(order.execPrice.isZero()) revert KeeperManager_CancelOrder_OrderAlreadyCancelled();

        (UFixed6 mktPrice, bool canFill) = _canFillOrder(order, market);
        if(!canFill) revert KeeperManager_CloseOrderKeeper_BadClose();

        --numOpenOrders[account][market];
        delete allOpenOrders[account][market][nonce];

        emit OrderExecuted(
            account,
            market,
            nonce,
            mktPrice,
            order.execPrice);
    }

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

    function _validateOrderFee(Order memory o, UFixed6 fee) internal pure returns (bool) {
        return o.size.muldiv(fee, UFixed6Lib.from(MAX_PCT)).gte(UFixed6Lib.from(o.maxFee));
    }
    
    function _readOrder(address account, address market, uint256 nonce) internal view returns (Order memory order) {
        order = allOpenOrders[account][market][nonce];
    }

    function _getMarketPrice(address market) internal view returns (UFixed6 price) {
        MarketParameter memory marketParam = IMarket(market).parameter();
        price = UFixed6Lib.from(marketParam.oracle.latest().price);
    }

}