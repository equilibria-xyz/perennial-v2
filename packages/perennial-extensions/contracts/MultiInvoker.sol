pragma solidity ^0.8.13;
pragma abicoder v2;

import {IOracleProvider} from "@equilibria/perennial-v2-oracle/contracts/IOracleProvider.sol";
import {
    IMultiInvoker, 
    IMarket, 
    UFixed6, 
    UFixed6Lib, 
    Fixed6, 
    Fixed6Lib,
    UFixed18,
    UFixed18Lib, 
    Position, 
    Local 
} from "./interfaces/IMultiInvoker.sol";
import {IKeeperManager} from "./interfaces/IKeeperManager.sol";

contract MultiInvoker is IMultiInvoker {
    //using PositionLib for Position;

    IOracleProvider public ethOracle;
    IKeeperManager public immutable keeper;

    Fixed6 public keeperPremium;
    
    constructor(address ethOracle_, address keeper_) {
        ethOracle = IOracleProvider(ethOracle_);
        keeper = IKeeperManager(keeper_);
    }

    function invoke(Invocation[] calldata invocations) external {
        _invoke(invocations);
    }

    function _invoke(Invocation[] calldata invocations) internal {
        for(uint i = 0; i < invocations.length; ++i) {
            Invocation memory invocation = invocations[i];

            if (invocation.action == PerennialAction.UPDATE) {
                (   
                    IMarket market,
                    UFixed6 newMaker,
                    UFixed6 newLong,
                    UFixed6 newShort,
                    Fixed6 newCollateral
                ) = abi.decode(invocation.args, (IMarket, UFixed6, UFixed6, UFixed6, Fixed6));

                market.update(msg.sender, newMaker, newLong, newShort, newCollateral);

            } else if (invocation.action == PerennialAction.PLACE_ORDER) {
                (address market, IKeeperManager.Order memory order) 
                    = abi.decode(invocation.args, (address, IKeeperManager.Order));

                keeper.placeOrder(msg.sender, market, order);
            } else if (invocation.action == PerennialAction.UPDATE_ORDER) {
                // modify tp / sl / max fee in keeper manager
                // modify collateral in market? size in keeper manager?

                (address market, IKeeperManager.Order memory newOrder, uint256 orderNonce) = 
                    abi.decode(invocation.args, (address, IKeeperManager.Order, uint256));

                keeper.updateOrder(msg.sender, market, orderNonce, newOrder);
            } else if (invocation.action == PerennialAction.CANCEL_ORDER) {
                (address market, uint256 orderNonce) = abi.decode(invocation.args, (address, uint256));

                keeper.cancelOrder(msg.sender, market, orderNonce);
            } else if (invocation.action == PerennialAction.EXEC_ORDER) {
                (address account, address market, uint256 orderNonce) = 
                    abi.decode(invocation.args, (address, address, uint256));
                
                _executeOrder(account, market, orderNonce);
            }
        }
    }

    function _executeOrder(address account, address market, uint256 orderNonce) internal {
        uint256 startGas = gasleft();

        Position memory position = IMarket(market).positions(account);
        IKeeperManager.Order memory order = keeper.readOrder(account, market, orderNonce);

        order.isLong ?
            order.isLimit ? 
                position.long.add(order.size) :
                position.long.sub(order.size) 
            :
            order.isLimit ?
                position.short.add(order.size) :
                position.short.sub(order.size) ;

        IMarket(market).update(
            account, 
            position.maker, 
            position.long, 
            position.short, 
            Fixed6Lib.ZERO);

        keeper.executeOrder(account, market, orderNonce);

        if(msg.sender != account) {
             _handleExecFee(
                account, 
                market, 
                order.maxFee, 
                startGas, 
                position);
        }
    }

    function _handleExecFee(
        address account,
        address market, 
        Fixed6 maxFee, 
        uint256 startGas, 
        Position memory position
    ) internal {
        
        Fixed6 gasUsed = Fixed6Lib.from(UFixed6.wrap(startGas - gasleft()));
        Fixed6 chargeFee = gasUsed.muldiv(keeperPremium, Fixed6.wrap(100));

        if(chargeFee.gt(maxFee)) revert MultiInvoker_ExecuteOrder_MaxFeeExceeded();

        IMarket(market).update(
            account, 
            position.maker, 
            position.long, 
            position.short,
            chargeFee.mul(Fixed6.wrap(-1)));

        uint256 fee = UFixed6.unwrap(chargeFee.abs());

        IMarket(market).token().push(msg.sender, UFixed18Lib.from(fee));

        emit KeeperFeeCharged(account, market, msg.sender, chargeFee);
    }

    function _ethPrice() internal returns (Fixed6) {
        return ethOracle.latest().price;
    }
}