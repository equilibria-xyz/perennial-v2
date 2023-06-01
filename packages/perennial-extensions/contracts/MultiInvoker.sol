pragma solidity ^0.8.13;
pragma abicoder v2;


import {IMultiInvoker, IMarket, UFixed6, UFixed6Lib, Position, Local } from "./interfaces/IMultiInvoker.sol";
import {IKeeperManager} from "./interfaces/IKeeperManager.sol";


contract MultiInvoker is IMultiInvoker {
    //using PositionLib for Position;

    IKeeperManager immutable keeper;
    
    constructor(address keeper_) {
        keeper = IKeeperManager(keeper_);
    }

    function invoke(Invocation[] calldata invocations) external {
        _invoke(invocations, msg.sender);
    }

    function _invoke(Invocation[] calldata invocations, address account) internal {
        for(uint i = 0; i < invocations.length; ++i) {
            Invocation memory invocation = invocations[i];

            if(invocation.action == PerennialAction.OPEN_ORDER) {
                (
                    address market,
                    IKeeperManager.Order memory order,
                    Position memory newPosition
                ) = abi.decode(invocation.args, (address, IKeeperManager.Order, Position));

                _placeOrder(market, order, newPosition);
            } else if (invocation.action == PerennialAction.CLOSE_ORDER) {
              

            } else if (invocation.action == PerennialAction.MODIFY_ORDER) {
                // modify tp / sl / max fee in keeper manager
                // modify collateral in market? size in keeper manager?

                (address market, IKeeperManager.Order memory newOrder, uint256 orderId) = 
                    abi.decode(invocation.args, (address, IKeeperManager.Order, uint256));

                _updateOrder(market, newOrder, orderId);
            } else if (invocation.action == PerennialAction.CANCEL_ORDER) {
                (address market, uint256 orderIndex) = abi.decode(invocation.args, (address, uint256));

                keeper.closeOrderInvoker(msg.sender, market, orderIndex);
            }
        }
    }

    function _placeOrder(address market, IKeeperManager.Order memory order, Position memory newPosition) internal {
        Position memory position = IMarket(market).positions(msg.sender);
        Local memory local = IMarket(market).locals(msg.sender);

        bool newLong = !position.long.eq(newPosition.long);
        bool newShort = !position.short.eq(newPosition.short);

        if(newLong && newShort) revert MultiInvoker_PlaceOrder_OrderMustBeSingleSided();
        order.size = newLong ? newPosition.long.sub(position.long) : newPosition.short.sub(position.short);

        // market order
        if(order.limitPrice.eq(UFixed6Lib.ZERO)) {
            IMarket(market).update(
                msg.sender, 
                newPosition.maker, 
                newPosition.long,
                newPosition.short, 
                local.collateral);
        }

        keeper.placeOrder(msg.sender, market, order);
    }


    function _closeOrder(address account, address market, uint256 orderIndex, UFixed6 close) internal {
        Position memory position = IMarket(market).positions(account);
        Local memory local = IMarket(market).locals(account);

        IKeeperManager.Order memory order = keeper.readOrderAtIndex(msg.sender, market, orderIndex);

        order.isLong ? 
            position.long = position.long.sub(order.size) :
            position.short = position.short.sub(order.size);
        
        IMarket(market).update(
            account, 
            position.maker, 
            position.long, 
            position.short, 
            local.collateral);
        
        if (account == msg.sender) {
            // avoids charging fee and checking tp/sl correctness
            // keeper.closeOrderInvoker();
        } else {
            // keeper.closeOrderKeeper();
        }

    }

    function _closeOrderKeeper(address account, IMarket market, uint256 orderIndex) internal {
        
    }

    function _updateOrder(address market, IKeeperManager.Order memory order, uint256 orderIndex) internal {
        keeper.updateOrder(msg.sender, market, orderIndex, order);
    }

    function _update( 
        address account,
        UFixed6 newMaker,
        UFixed6 newLong,
        UFixed6 newShort,
        UFixed6 newCollateral
    ) internal {

    }
}