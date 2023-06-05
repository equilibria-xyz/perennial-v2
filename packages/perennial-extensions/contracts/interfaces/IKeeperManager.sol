pragma solidity ^0.8.13;

import { IMarket, Position, MarketParameter } from "@equilibria/perennial-v2/contracts/interfaces/IMarket.sol";
import { UFixed6, UFixed6Lib } from "@equilibria/root-v2/contracts/UFixed6.sol";
import { Fixed6, Fixed6Lib } from "@equilibria/root-v2/contracts/Fixed6.sol";

interface IKeeperManager {

    // (-) exec price -> execute order when market price >= exec price 
    // (+) exec price -> execure order when market price <= 
    struct Order {
        // slot 1
        bool isLimit; // true/false = increase/decrease order size of market position upon execution
        bool isLong;  // true/false = change long/short size of market position upon execution
        Fixed6 maxFee; // @todo optimization: set as % with some precision

        // slot 2&3
        Fixed6 execPrice; // execute order when mkt price >= (-) execPrice or mkt price <= (+) execPrice
        UFixed6 size;     // notional (?) magnitude of order on market position
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
    
    event OrderPlaced(
        address indexed account, 
        address indexed market,
        uint256 orderNonce,
        uint8 _openOrders,
        Fixed6 execPrice,
        Fixed6 maxFee);    

    event OrderExecuted(
        address indexed account,
        address indexed market,
        uint256 nonce,
        UFixed6 marketPrice,
        Fixed6 execPrice);


    event OrderCancelled(address indexed account, address indexed market, uint256 orderNonce);

    event OrderUpdated(
        address indexed account, 
        address indexed market, 
        uint256 orderNonce, 
        Fixed6 execPrice,
        Fixed6 maxFee);

    function readOrder(address account, address market, uint256 nonce) external view returns(Order memory);
    function placeOrder(address account, address market, Order memory order) external;
    function updateOrder(address account, address market, uint256 nonce, Order memory update) external;
    function cancelOrder(address account, address market, uint256 nonce) external; 
    function executeOrder(address account, address market, uint256 nonce) external;
    
}