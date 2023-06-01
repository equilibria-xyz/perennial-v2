pragma solidity ^0.8.13;

import { IMarket, Position, MarketParameter } from "@equilibria/perennial-v2/contracts/interfaces/IMarket.sol";
import { UFixed6, UFixed6Lib } from "@equilibria/root-v2/contracts/UFixed6.sol";

interface IKeeperManager {

    struct Order {
        // slot 1
        bool isLong;
        bool isFilled;
        uint8 maxFee;
        uint128 nonce;

        UFixed6 limitPrice; // 0 on open if market order
        UFixed6 size;
        UFixed6 takeProfit;
        UFixed6 stopLoss; 
    }

    error KeeeperManager_NotOnlyInvoker();
    error KeeperManager_NotOnlyKeeper();
    error KeeperManager_BadOrderParams();
    error KeeperManager_MaxFeeGt100();
    error KeeperManager_PlaceOrder_MaxOpenOrders();
    error KeeperManager_UpdateOrder_OrderDoesNotExist();
    error KeeperManager_CancelOrder_OrderAlreadyCancelled();
    error KeeperManager_CloseOrderKeeper_CannotCancelUnfilledOrder();
    error KeeperManager_CloseOrderKeeper_BadClose();
    error KeeperManager_FillOrder_CannotFill();

    event OrderOpened(
        address indexed account, 
        address indexed market, 
        uint256 index, 
        uint256 orderNonce, 
        bool isLimit,
        UFixed6 takeProfit,
        UFixed6 stopLoss,
        uint8 fee);
    event OrderClosed(address indexed account, address indexed market, uint256 orderIndex, uint128 orderNonce); // todo fee accrued
    event OrderCancelled(address indexed account, address indexed market, uint256 orderIndex, uint128 orderNonce); // todo fee accrued
    
    event OrderUpdated(
        address indexed account, 
        address indexed market, 
        uint256 index, 
        uint256 nonce,
        UFixed6 newTakeProfit,
        UFixed6 newStopLoss,
        UFixed6 limitPrice,
        uint8 newFee);

    event OrderFilled(
            address indexed account,
            address indexed market,
            uint256 orderIndex,
            uint128 orderNonce,
            UFixed6 limitPrice,
            UFixed6 fillPrice);
        // todo fee accrued

    function readOrderAtIndex(address account, address market, uint256 index) external view returns (Order memory order);
    function placeOrder(address account, address market, Order memory order) external;
    function updateOrder(address account, address market, uint256 orderIndex, Order memory order) external;
    function closeOrderInvoker(address account, address market, uint256 index) external;
    function closeOrderKeeper(address account, address market, uint256 index) external;

}