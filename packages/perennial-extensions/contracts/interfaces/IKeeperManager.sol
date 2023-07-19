// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { IMarket, Position, MarketParameter } from "@equilibria/perennial-v2/contracts/interfaces/IMarket.sol";
import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { Fixed6, Fixed6Lib } from "@equilibria/root/number/types/Fixed6.sol";

// TODO: add methods
interface IKeeperManager {

    // (-) exec price -> execute order when market price >= exec price
    // (+) exec price -> execure order when market price <= exec price

    // TODO: you can pack this in a single slot -- make a type for it w/ a storage lib
    struct Order {
        // slot 1
        bool isLong;  // true/false = change long/short size of market position upon execution
        bool priceBelow; // latest price vs exec price
        UFixed6 maxFee;

        // slot 2&3
        Fixed6 execPrice; // - for market price sign
        Fixed6 size;      // limit or trigger,+ size increases position - vice versa
    }

    // error KeeeperManager_NotOnlyInvoker();
    // error KeeperManager_NotOnlyKeeper();
    // error KeeperManager_BadOrderParams();
    // error KeeperManager_MaxFeeGt100();
    // error KeeperManager_UpdateOrder_OrderDoesNotExist();
    // error KeeperManager_CloseOrderKeeper_CannotCancelUnfilledOrder();
    // error KeeperManager_FillOrder_CannotFill();

    error KeeperManagerBadCloseError();
    error KeeperManagerMaxOpenOrdersError();
    error KeeperManagerOrderAlreadyCancelledError();

    event OrderOpened(address indexed account, IMarket indexed market, uint256 index, uint256 orderNonce, bool isLimit, UFixed6 takeProfit, UFixed6 stopLoss, uint8 fee);
    event OrderPlaced(address indexed account, IMarket indexed market, uint256 indexed nonce, Order order);
    event OrderExecuted(address indexed account, IMarket indexed market, uint256 nonce, uint256 positionId);
    event OrderCancelled(address indexed account, IMarket indexed market, uint256 orderNonce);
}