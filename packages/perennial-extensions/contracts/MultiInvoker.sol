// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { AggregatorV3Interface } from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import { IMarketFactory } from "@equilibria/perennial-v2/contracts/interfaces/IMarketFactory.sol";
import { IBatcher } from "@equilibria/emptyset-batcher/interfaces/IBatcher.sol";
import { IEmptySetReserve } from "@equilibria/emptyset-batcher/interfaces/IEmptySetReserve.sol";
import { IInstance } from "@equilibria/root-v2/contracts/IInstance.sol";
import { IPythOracle } from "@equilibria/perennial-v2-oracle/contracts/interfaces/IPythOracle.sol";

import "./interfaces/IMultiInvoker.sol";
import "./KeeperManager.sol";
import "@equilibria/root-v2/contracts/UKept.sol";

contract MultiInvoker is IMultiInvoker, KeeperManager, UKept {

    /// @dev Gas buffer estimating remaining execution gas to include in fee to cover further instructions
    uint256 public constant GAS_BUFFER = 100000; // solhint-disable-line var-name-mixedcase

    /// @dev USDC stablecoin address
    Token6 public immutable USDC; // solhint-disable-line var-name-mixedcase

    /// @dev DSU address
    Token18 public immutable DSU; // solhint-disable-line var-name-mixedcase

    /// @dev Protocol factory to validate market approvals
    IMarketFactory public immutable factory;

    /// @dev Batcher address
    IBatcher public immutable batcher;

    /// @dev Reserve address
    IEmptySetReserve public immutable reserve;

    /// @dev multiplier to charge accounts on top of gas cost for keeper executions
    UFixed6 public keeperMultiplier;

    constructor(
        Token6 usdc_,
        Token18 dsu_,
        IMarketFactory factory_,
        IBatcher batcher_,
        IEmptySetReserve reserve_
    ) {
        USDC = usdc_;
        DSU = dsu_;
        factory = factory_;
        batcher = batcher_;
        reserve = reserve_;
        keeperMultiplier = UFixed6.wrap(1.2e6); // TODO ???
    }

    function initialize(AggregatorV3Interface ethOracle_) external initializer(1) {
        __UKept__initialize(ethOracle_, DSU);
    }

    /// @notice approves a market deployed by the factory to spend DSU
    /// @param market Market to approve max DSU spending
    function approve(address market) external { _approve(market); }

    /// @notice entry to perform invocations
    /// @param invocations List of actions to execute in order
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

                _update(market, makerDelta, longDelta, shortDelta, collateralDelta, handleWrap);
            } else if (invocation.action == PerennialAction.PLACE_ORDER) {
                (address market, IKeeperManager.Order memory order)
                    = abi.decode(invocation.args, (address, IKeeperManager.Order));

                _placeOrder(market, order);
            } else if (invocation.action == PerennialAction.CANCEL_ORDER) {
                (address market, uint256 nonce) = abi.decode(invocation.args, (address, uint256));

                _cancelOrder(market, nonce);
            } else if (invocation.action == PerennialAction.EXEC_ORDER) {
                (address account, address market, uint256 nonce) =
                    abi.decode(invocation.args, (address, address, uint256));

                _executeOrderInvoker(account, market, nonce);
            } else if (invocation.action == PerennialAction.COMMIT_PRICE) {
                (address oracleProvider, uint256 version, bytes memory data) =
                    abi.decode(invocation.args, (address, uint256, bytes));

                IPythOracle(oracleProvider).commit(version, data);
            } else if (invocation.action == PerennialAction.LIQUIDATE) {
                (address market, address account) =
                    abi.decode(invocation.args, (address, address));

                _liquidate(IMarket(market), account);
            } else if (invocation.action == PerennialAction.APPROVE_MARKET) {
                (address market) =
                    abi.decode(invocation.args, (address));
                _approve(market);
            }
        }
    }

    /**
     * @notice Updates market on behalf of msg.sender
     * @param market Address of market up update
     * @param newMaker New maker position for msg.sender in `market`
     * @param newLong New long position for msg.sender in `market`
     * @param newShort New short position for msg.sender in `market`
     * @param collateralDelta Net change in collateral for msg.sender in `market`
     */
    function _update(
        address market,
        UFixed6 newMaker,
        UFixed6 newLong,
        UFixed6 newShort,
        Fixed6 collateralDelta,
        bool handleWrap
    ) internal {
        // collateral is transferred from this address to the market, transfer from msg.sender to here
        if (collateralDelta.sign() == 1) _deposit(collateralDelta.abs(), handleWrap);

        IMarket(market).update(msg.sender, newMaker, newLong, newShort, collateralDelta, false);

        // collateral is transferred from the market to this address, transfer to msg.sender from here
        if (collateralDelta.sign() == -1) _withdraw(msg.sender, collateralDelta.abs(), handleWrap);
    }

    function _liquidate(IMarket market, address account) internal {
        // sync and settle
        // TODO: I checked and this doesn't currently work -- will revert on update if position is undercollateralized
        // TODO: we'll have to do something else here, or change the invariant
        market.update(account, UFixed6Lib.MAX, UFixed6Lib.MAX, UFixed6Lib.MAX, Fixed6Lib.ZERO, false);

        UFixed6 liquidationFee = _liquidationFee(market, account);

        market.update(
            account,
            UFixed6Lib.ZERO,
            UFixed6Lib.ZERO,
            UFixed6Lib.ZERO,
            Fixed6Lib.from(-1, liquidationFee),
            true
        );

        _withdraw(msg.sender, liquidationFee, false);
    }

    /**
     * @notice executes an `account's` open order for a `market` and pays a fee to `msg.sender`
     * @param account Account to execute order of
     * @param market Market to execute order for
     * @param nonce Id of open order to index
     */
    function _executeOrderInvoker(
        address account,
        address market,
        uint256 nonce
    ) internal keep(UFixed18Lib.from(keeperMultiplier), GAS_BUFFER, abi.encode(account, market, nonce)) {
        Position memory position = IMarket(market).pendingPositions(account, IMarket(market).locals(account).currentId);
        IKeeperManager.Order memory order = orders(account, market, nonce);

        if (order.isLong) position.long = order.isLimit ? position.long.add(order.size) : position.long.sub(order.size);
        else position.short = order.isLimit ? position.short.add(order.size) : position.short.sub(order.size);

        IMarket(market).update(
            account,
            position.maker,
            position.long,
            position.short,
            Fixed6Lib.ZERO,
            false
        );

        // TODO: yeah, this is confusing to follow with the rest of the logic in a separate file
        _executeOrder(account, market, nonce);
    }

    function _raiseKeeperFee(UFixed18 keeperFee, bytes memory data) internal override {
        (address account, address market, uint256 nonce) = abi.decode(data, (address, address, uint256));
        if (keeperFee.gt(UFixed18Lib.from(orders(account, market, nonce).maxFee)))
            revert MultiInvokerMaxFeeExceededError();

        IMarket(market).update(
            account,
            UFixed6Lib.MAX,
            UFixed6Lib.MAX,
            UFixed6Lib.MAX,
            Fixed6Lib.from(Fixed18Lib.from(-1, keeperFee)),
            false
        );
    }

    /// @notice Helper fn to max approve DSU for usage in a market deployed by the factory
    /// @param market Market to approve
    function _approve(address market) internal {
        if(!factory.instances(IInstance(market))) revert MultiInvokerInvalidMarketApprovalError();
        DSU.approve(address(market));
    }

    /**
     * @notice Pull DSU or wrap and deposit USDC from msg.sender to this address for market usage
     * @param collateralDelta Amount to transfer
     * @param handleWrap Flag to wrap USDC to DSU
     */
    function _deposit(UFixed6 collateralDelta, bool handleWrap) internal {
        if(handleWrap) {
            USDC.pull(msg.sender, UFixed18Lib.from(collateralDelta), true);
            _handleWrap(address(this), UFixed18Lib.from(collateralDelta));
        } else {
            DSU.pull(msg.sender, UFixed18Lib.from(collateralDelta)); // @todo change to 1e6?
        }
    }

    /**
     * @notice Push DSU or unwrap DSU to push USDC from this address to `account`
     * @param account Account to push DSU or USDC to
     * @param collateralDelta Amount to transfer
     * @param handleUnwrap flag to unwrap DSU to USDC
     */
    function _withdraw(address account, UFixed6 collateralDelta, bool handleUnwrap) internal {
        if (handleUnwrap) {
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

    // TODO: would be cool if we could figure out a way to "fake-settle" just to get the latest position
    // TODO: could use the oracle + market pending position, but also need to take into account invalid versions
    // TODO: if we get that we don't need to solve the invariant issue above
    function _liquidationFee(IMarket market, address account) internal view returns (UFixed6) {
        Position memory position = market.positions(account);
        RiskParameter memory parameter = market.riskParameter();
        OracleVersion memory latestVersion = _latestVersionPrice(market, position);

        return position
            .liquidationFee(latestVersion, parameter)
            .min(UFixed6Lib.from(market.token().balanceOf(address(market))));
    }

    function _latestVersionPrice(
        IMarket market,
        Position memory position
    ) internal view returns (OracleVersion memory latestVersion) {
        latestVersion = market.at(position.timestamp);

        latestVersion.price = latestVersion.valid ?
            latestVersion.price :
            market.global().latestPrice;
    }
}
