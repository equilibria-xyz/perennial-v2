pragma solidity ^0.8.13;

import {IMultiInvoker } from "./interfaces/IMultiInvoker.sol";
import {IKeeperManager, IMarket, MarketParameter, UFixed6, UFixed6Lib} from "./interfaces/IKeeperManager.sol";


import { Fixed6 } from "@equilibria/root-v2/contracts/Fixed6.sol";

contract KeeperManager is IKeeperManager {

    // auth state
    IMultiInvoker public invoker;
    // mapping(IKeeper => bool) private _keeperAdapterApproved;

    // order state
    mapping(address => mapping(address => uint128)) public userOrderNonce;
    mapping(address => mapping(address => Order[10])) internal _allOpenOrders;

    uint8 public constant MAX_PCT = 100;

    UFixed6 private constant ZERO = UFixed6.wrap(0);

    constructor(address invoker_) {
        invoker = IMultiInvoker(invoker_);
    }

    modifier onlyInvoker() {
        if (msg.sender != address(invoker)) revert KeeeperManager_NotOnlyInvoker();  
        _;
    }

    modifier validateOrderParams(address market, Order memory order) {
        _validateOrderParams(market, order);
        _;
    }

    function readOrderAtIndex(address account, address market, uint256 index) public view returns (Order memory order) {
        order = _readOrder(account, market, index);
    }

    function readOpenOrder(address account, address market, uint256 nonce) public view returns (Order memory order) {
        Order[10] memory orders = _allOpenOrders[account][market];

        for(uint i = 0; i < 10; ++i) {
            
            if(orders[i].nonce == nonce) order = orders[i];
        }
    }

    /// @notice Places order on behalf of `account` from the invoker
    function placeOrder(
        address account, 
        address market, 
        Order memory order
    ) external onlyInvoker validateOrderParams(market, order) {
        _placeOrder(account, market, order);
    }

    /// @notice Opdate order invoker action to change stop loss, take profit, and or (if limit not filled) limit price.
    function updateOrder(
        address account,
        address market,
        uint256 orderIndex,
        Order memory order
    ) external onlyInvoker validateOrderParams(market, order) {
        Order memory openOrder = _readOrder(account, market, orderIndex);
        if(openOrder.nonce == 0) revert KeeperManager_UpdateOrder_OrderDoesNotExist();

        _updateOrder(account, market, orderIndex, openOrder, order);
    }

    /// @notice Keeper function that can be called to fill and order at limit price sends proceeds to 
    function fillOrder(
        address account,
        address market,
        uint256 orderIndex
    ) external returns (bool) {
        Order memory order = _readOrder(account, market, orderIndex);

        (UFixed6 fillPrice, bool canFill) = _canFillOrder(order, market);
        if(!canFill) revert KeeperManager_FillOrder_CannotFill();

        emit OrderFilled(
            account,
            market,
            orderIndex,
            order.nonce,
            order.limitPrice,
            fillPrice
        );

        order.limitPrice = UFixed6Lib.ZERO;
        _allOpenOrders[account][market][orderIndex] = order;
    }

    /// @notice Cancel order invoker action to remove limit order # `index` on behalf of `account` in `market`
    function closeOrderInvoker(
        address account,
        address market,
        uint256 index
    ) external onlyInvoker {
        Order memory order = _readOrder(account, market, index);

        if(order.nonce == 0) revert KeeperManager_CancelOrder_OrderAlreadyCancelled();
        
        if(order.isFilled) {
            emit OrderClosed(account, market, index, order.nonce);
        } else {
            emit OrderCancelled(account, market, index, order.nonce);
        }

        delete _allOpenOrders[account][market][index];
    }

    /// @notice Close order invoker action to close a market or (filled) limit order
    function closeOrderKeeper(
        address account,
        address market,
        uint256 index
    ) external onlyInvoker {
        Order memory order = _readOrder(account, market, index);

        if(order.nonce == 0) return;

        if(!order.isFilled) revert KeeperManager_CloseOrderKeeper_CannotCancelUnfilledOrder();
        if(!_canCloseOrderKeeper(order, market)) revert KeeperManager_CloseOrderKeeper_BadClose();


        emit OrderClosed(account, market, index, order.nonce);

        delete _allOpenOrders[account][market][index];
    }

    function _placeOrder(address account, address market, Order memory order) internal {
        uint256 orderNonce = userOrderNonce[account][market];
        // if (orderNonce == 0) _initializeOrderStorage(account, market);

        order.isFilled = order.limitPrice.isZero();
        uint256 index = _insertOrder(account, market, order);

        emit OrderOpened(
            account, 
            market,
            index, 
            ++orderNonce, 
            order.limitPrice.isZero() ? false : true,
            order.takeProfit,
            order.stopLoss,
            order.maxFee);
    }

    function _updateOrder(address account, address market, uint256 index, Order memory openOrder, Order memory update) internal {

        // @todo is there a cleaner way to do this safely?
        openOrder.takeProfit = update.takeProfit.eq(ZERO) ? openOrder.takeProfit : update.takeProfit;
        openOrder.stopLoss = update.stopLoss.eq(ZERO) ? openOrder.stopLoss : update.stopLoss;
        openOrder.limitPrice = openOrder.isFilled ? openOrder.limitPrice : update.limitPrice;
        openOrder.maxFee = update.maxFee == 0 ? openOrder.maxFee : update.maxFee;

        _allOpenOrders[account][market][index] = openOrder;

        emit OrderUpdated(
            account, 
            market, 
            index, 
            openOrder.nonce, 
            openOrder.takeProfit, 
            openOrder.stopLoss, 
            openOrder.limitPrice,
            openOrder.maxFee);
    }

    function _canFillOrder(Order memory o, address market) internal view returns (UFixed6, bool) {
        // order does not exist or is already filled
        if (o.nonce == 0 || o.isFilled) return (UFixed6Lib.ZERO, false);

        UFixed6 price = _getMarketPrice(market);
        bool canFill = o.isLong ? 
            (price.lte(o.limitPrice)) && !o.isFilled:  // net long
            (price.gte(o.limitPrice)) && !o.isFilled; // net short

        return (price, canFill);
    }

    function _canCloseOrderKeeper(Order memory o, address market) internal view returns (bool) {
        if(!o.isFilled) return false;

        UFixed6 price = _getMarketPrice(market);

        (UFixed6 topRange, UFixed6 bottomRange) = o.isLong ? 
            (o.takeProfit, o.stopLoss) : // net long spread
            (o.stopLoss, o.takeProfit) ; // net short spread
            
        if(!topRange.isZero() && price.gte(topRange)) return true;
        if(!bottomRange.isZero() && price.lte(bottomRange)) return true;

        return false;
    }

    function _validateOrderFee(Order memory o, UFixed6 fee) internal pure returns (bool) {
        return o.size.muldiv(fee, UFixed6Lib.from(MAX_PCT)).gte(UFixed6Lib.from(uint256(o.maxFee)));
    }

    function _validateOrderParams(
        address market, 
        Order memory o
    ) internal view {  
        if(o.maxFee > MAX_PCT) revert KeeperManager_MaxFeeGt100();

        (UFixed6 topRange, UFixed6 bottomRange) = o.isLong ?
            (o.takeProfit, o.stopLoss) : // net long spread
            (o.stopLoss, o.takeProfit) ; // net short spread
        
        // @todo market price does not dos keepers, not needed?
        UFixed6 orderPrice = !o.limitPrice.isZero() ?
            o.limitPrice : 
            _getMarketPrice(market);

        // order price must be within close prices if they are set (non-0)
        if (orderPrice.lte(bottomRange)) revert KeeperManager_BadOrderParams();
        if (!topRange.isZero() && orderPrice.gte(topRange)) revert KeeperManager_BadOrderParams();
    }
    
    function _readOrder(address account, address market, uint256 index) internal view returns (Order memory order) {
        order = _allOpenOrders[account][market][index];
    }

    function _insertOrder(address account, address market, Order memory order) internal returns(uint256 index) {
        Order[10] storage openOrders = _allOpenOrders[account][market];

        for(uint i; i < 10; ++i) {
            if(openOrders[i].nonce == 0) {
                uint128 nonce = userOrderNonce[account][market];
                ++nonce;
                order.nonce = nonce;
                ++userOrderNonce[account][market];

                openOrders[i] = order; 
                return i;
            }
        }
        revert KeeperManager_PlaceOrder_MaxOpenOrders();
    }


    function _safeReadFreeOrderIndex(address account, address market) internal view returns (uint256 index) {
        Order[10] memory openOrders = _allOpenOrders[account][market];

        for(uint i; i < 10; ++i) {
            if(openOrders[i].nonce == 0) {
                return i;
            }
        }
        revert KeeperManager_PlaceOrder_MaxOpenOrders();
    }

    // function _initializeOrderStorage(address account, address market) internal {
    //     _allOpenOrders[account][market] = Order[](10);
    // }

    function _getMarketPrice(address market) internal view returns (UFixed6 price) {
        MarketParameter memory marketParam = IMarket(market).parameter();
        price = UFixed6Lib.from(marketParam.oracle.latest().price);
    }

}

    // function closeOrdersInvoker(
    //     address account,
    //     IMarket market, 
    //     uint256[] calldata indices
    // ) external onlyInvoker {
    //     if(indices.length == 0) {
    //         delete _allOpenOrders[account][market];
    //     } else {
    //         for(uint i = 0; i < indices.length; ++i) {
    //             delete _allOpenOrders[account][market][indices[i]];
    //         }
    //     }
    //  }