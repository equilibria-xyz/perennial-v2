pragma solidity ^0.8.13;
pragma abicoder v2;

import {IOracleProvider} from "@equilibria/perennial-v2-oracle/contracts/IOracleProvider.sol";
import { IBatcher } from "@equilibria/emptyset-batcher/interfaces/IBatcher.sol";
import { IEmptySetReserve } from "@equilibria/emptyset-batcher/interfaces/IEmptySetReserve.sol";
// import "hardhat/console.sol";

import {
    IMultiInvoker,
    IMarket, 
    Position,
    Local,
    UFixed18Lib,
    UFixed18,
    UFixed6,
    UFixed6Lib,
    Fixed6,
    Fixed6Lib,
    Token6,
    Token18
} from "./interfaces/IMultiInvoker.sol";
import {IKeeperManager} from "./interfaces/IKeeperManager.sol";

import {KeeperManager} from "./KeeperManager.sol";

contract MultiInvoker is IMultiInvoker, KeeperManager {

    /// @dev USDC stablecoin address
    Token6 public immutable USDC; // solhint-disable-line var-name-mixedcase

    /// @dev DSU address
    Token18 public immutable DSU; // solhint-disable-line var-name-mixedcase

    /// @dev Batcher address
    IBatcher public immutable batcher;

    /// @dev Perennial oracle for eth price
    IOracleProvider public ethOracle;

    /// @dev Reserve address
    IEmptySetReserve public immutable reserve;

    /// @dev premium to charge accounts on top of gas cost for keeper executions
    Fixed6 public keeperPremium;

    constructor(
        Token6 usdc_,
        Token18 dsu_,
        IBatcher batcher_,
        IEmptySetReserve reserve_,
        IOracleProvider ethOracle_
    ) {
        USDC = usdc_;
        DSU = dsu_;
        batcher = batcher_;
        ethOracle = ethOracle_;
        reserve = reserve_;
        keeperPremium = Fixed6.wrap(8);
    }

    // @todo UOwnable
    function initialize() external {

    }

    function invoke(Invocation[] calldata invocations) external {

        for(uint i = 0; i < invocations.length; ++i) {
            Invocation memory invocation = invocations[i];

            if (invocation.action == PerennialAction.UPDATE_POSITION) {

                (
                    address market,
                    UFixed6 makerDelta,
                    UFixed6 longDelta,
                    UFixed6 shortDelta,
                    Fixed6 collateralDelta,
                    bool handleWrap
                ) = abi.decode(invocation.args, (address, UFixed6, UFixed6, UFixed6, Fixed6, bool));

                _update(msg.sender, market, makerDelta, longDelta, shortDelta, collateralDelta, handleWrap);
            } else if (invocation.action == PerennialAction.PLACE_ORDER) {
                (address market, IKeeperManager.Order memory order)
                    = abi.decode(invocation.args, (address, IKeeperManager.Order));

                _placeOrder(msg.sender, market, order);
            } else if (invocation.action == PerennialAction.CANCEL_ORDER) {
                (address market, uint256 _orderNonce) = abi.decode(invocation.args, (address, uint256));

                _cancelOrder(msg.sender, market, _orderNonce);
            } else if (invocation.action == PerennialAction.EXEC_ORDER) {
                (address account, address market, uint256 _orderNonce) =
                    abi.decode(invocation.args, (address, address, uint256));

                _executeOrderInvoker(account, market, _orderNonce);
            }
        }
    }

    function _update(
        address account,
        address market,
        UFixed6 newMaker,
        UFixed6 newLong,
        UFixed6 newShort,
        Fixed6 collateralDelta,
        bool handleWrap
    ) internal returns (Position memory position) {
        position = IMarket(market).positions(account);


        position.maker = newMaker;
        position.long = newLong;
        position.short = newShort;

        // collateral is transferred from this address to the market, transfer from account to here
        if(collateralDelta.sign() == 1) {
            _deposit(account, collateralDelta.abs(), handleWrap);
        }

        IMarket(market).update(
            account,
            position.maker,
            position.long,
            position.short,
            collateralDelta);

        // collateral is transferred from the market to this address, transfer to account from here
        if(collateralDelta.sign() == -1) {
            _withdraw(account, collateralDelta.abs(), handleWrap);
        }
    }

    function _executeOrderInvoker(address account, address market, uint256 _orderNonce) internal {
        uint256 startGas = gasleft();

        Position memory position = IMarket(market).positions(account);
        IKeeperManager.Order memory order = _readOrder(account, market, _orderNonce);

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

        _executeOrder(account, market, _orderNonce);

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

        Fixed6 ethPrice = ethPrice();
        Fixed6 gasUsed = Fixed6Lib.from(UFixed6.wrap(startGas - gasleft()));
        Fixed6 chargeFee = gasUsed.muldiv(keeperPremium, Fixed6.wrap(100));

        if(chargeFee.gt(maxFee)) revert MultiInvoker_ExecuteOrder_MaxFeeExceeded();

        chargeFee = chargeFee.mul(Fixed6Lib.NEG_ONE).mul(ethPrice);

        IMarket(market).update(
            account,
            position.maker,
            position.long,
            position.short,
            chargeFee);

        _withdraw(msg.sender, chargeFee.abs(), false);

        emit KeeperFeeCharged(account, market, msg.sender, chargeFee.abs());
    }

    function ethPrice() public view returns (Fixed6) {
        return ethOracle.latest().price;
    }

    function _deposit(address account, UFixed6 collateralDelta, bool handleWrap ) internal {
        if(handleWrap) {
            USDC.pull(msg.sender, UFixed18Lib.from(collateralDelta), true);
            _handleWrap(address(this), UFixed18Lib.from(collateralDelta));
        } else {
            DSU.pull(account, UFixed18Lib.from(collateralDelta)); // @todo change to 1e6?
        }
    }

    function _withdraw(address account, UFixed6 collateralDelta, bool handleUnwrap) internal {
        if(handleUnwrap) {
            DSU.push(account, UFixed18Lib.from(collateralDelta));
            _handleUnwrap(account, UFixed18Lib.from(collateralDelta));
        } else {
            DSU.push(account, UFixed18Lib.from(collateralDelta)); // // @todo change to 1e6?
        }
    }

    /**
     * @notice Helper function to wrap `amount` USDC from `msg.sender` into DSU using the batcher or reserve
     * @param receiver Address to receive the DSU
     * @param amount Amount of USDC to wrap
     */
    function _handleWrap(address receiver, UFixed18 amount) internal {
        // If the batcher is 0 or  doesn't have enough for this wrap, go directly to the reserve
        if (address(batcher) == address(0) || amount.gt(DSU.balanceOf(address(batcher)))) {
            reserve.mint(amount);
            if (receiver != address(this)) DSU.push(receiver, amount);
        } else {
            // Wrap the USDC into DSU and return to the receiver
            batcher.wrap(amount, receiver);
        }
    }

    /**
     * @notice Helper function to unwrap `amount` DSU into USDC and send to `receiver`
     * @param receiver Address to receive the USDC
     * @param amount Amount of DSU to unwrap
     */
    function _handleUnwrap(address receiver, UFixed18 amount) internal {
        // If the batcher is 0 or doesn't have enough for this unwrap, go directly to the reserve
        if (address(batcher) == address(0) || amount.gt(USDC.balanceOf(address(batcher)))) {
            reserve.redeem(amount);
            if (receiver != address(this)) USDC.push(receiver, amount);
        } else {
            // Unwrap the DSU into USDC and return to the receiver
            batcher.unwrap(amount, receiver);
        }
    }
}
