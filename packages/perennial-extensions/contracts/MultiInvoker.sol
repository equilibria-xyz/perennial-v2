// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { AggregatorV3Interface } from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import { IEmptySetReserve } from "@equilibria/emptyset-batcher/interfaces/IEmptySetReserve.sol";
import { IFactory } from "@equilibria/root/attribute/interfaces/IFactory.sol";
import { IBatcher } from "@equilibria/emptyset-batcher/interfaces/IBatcher.sol";
import { IInstance } from "@equilibria/root/attribute/interfaces/IInstance.sol";
import { IPythOracle } from "@equilibria/perennial-v2-oracle/contracts/interfaces/IPythOracle.sol";
import { IVault } from "@equilibria/perennial-v2-vault/contracts/interfaces/IVault.sol";
import "./interfaces/IMultiInvoker.sol";
import "./types/TriggerOrder.sol";
import "@equilibria/root/attribute/Kept.sol";


/// @title MultiInvoker
/// @notice Extension to handle batched calls to the Perennial protocol
contract MultiInvoker is IMultiInvoker, Kept {
    /// @dev Gas buffer estimating remaining execution gas to include in fee to cover further instructions
    uint256 public constant GAS_BUFFER = 100000; // solhint-disable-line var-name-mixedcase

    /// @dev USDC stablecoin address
    Token6 public immutable USDC; // solhint-disable-line var-name-mixedcase

    /// @dev DSU address
    Token18 public immutable DSU; // solhint-disable-line var-name-mixedcase

    /// @dev Protocol factory to validate market approvals
    IFactory public immutable marketFactory;

    /// @dev Vault factory to validate vault approvals
    IFactory public immutable vaultFactory;

    /// @dev Batcher address
    IBatcher public immutable batcher;

    /// @dev Reserve address
    IEmptySetReserve public immutable reserve;

    /// @dev multiplier to charge accounts on top of gas cost for keeper executions
    UFixed6 public immutable keeperMultiplier;

    /// @dev UID for an order
    uint256 public latestNonce;

    /// @dev State for the order data
    mapping(address => mapping(IMarket => mapping(uint256 => TriggerOrderStorage))) private _orders;

    /// @notice Constructs the MultiInvoker contract
    /// @param usdc_ USDC stablecoin address
    /// @param dsu_ DSU address
    /// @param marketFactory_ Protocol factory to validate market approvals
    /// @param vaultFactory_ Protocol factory to validate vault approvals
    /// @param batcher_ Batcher address
    /// @param reserve_ Reserve address
    /// @param keeperMultiplier_ multiplier to charge accounts on top of gas cost for keeper executions
    constructor(
        Token6 usdc_,
        Token18 dsu_,
        IFactory marketFactory_,
        IFactory vaultFactory_,
        IBatcher batcher_,
        IEmptySetReserve reserve_,
        UFixed6 keeperMultiplier_
    ) {
        USDC = usdc_;
        DSU = dsu_;
        marketFactory = marketFactory_;
        vaultFactory = vaultFactory_;
        batcher = batcher_;
        reserve = reserve_;
        keeperMultiplier = keeperMultiplier_;
    }

    /// @notice Initialize the contract
    /// @param ethOracle_ Chainlink ETH/USD oracle address
    function initialize(AggregatorV3Interface ethOracle_) external initializer(1) {
        __UKept__initialize(ethOracle_, DSU);

        if (address(batcher) != address(0)) {
            DSU.approve(address(batcher));
            USDC.approve(address(batcher));
        }

        DSU.approve(address(reserve));
        USDC.approve(address(reserve));
    }

    /// @notice View function to get order state
    /// @param account Account to get open oder of
    /// @param market Market to get open order in
    /// @param nonce UID of order
    function orders(address account, IMarket market, uint256 nonce) public view returns (TriggerOrder memory) {
        return _orders[account][market][nonce].read();
    }

    /// @notice Returns whether an order can be executed
    /// @param account Account to get open oder of
    /// @param market Market to get open order in
    /// @param nonce UID of order
    /// @return canFill Whether the order can be executed
    function canExecuteOrder(address account, IMarket market, uint256 nonce) public view returns (bool) {
        TriggerOrder memory order = orders(account, market, nonce);
        if (order.fee.isZero()) return false;
        return order.fillable(_getMarketPrice(market, account));
    }

    /// @notice entry to perform invocations
    /// @param invocations List of actions to execute in order
    function invoke(Invocation[] calldata invocations) external payable {
        for(uint i = 0; i < invocations.length; ++i) {
            Invocation memory invocation = invocations[i];

            if (invocation.action == PerennialAction.UPDATE_POSITION) {
                (
                    IMarket market,
                    UFixed6 newMaker,
                    UFixed6 newLong,
                    UFixed6 newShort,
                    Fixed6 collateral,
                    bool wrap
                ) = abi.decode(invocation.args, (IMarket, UFixed6, UFixed6, UFixed6, Fixed6, bool));

                _update(market, newMaker, newLong, newShort, collateral, wrap);
            } else if (invocation.action == PerennialAction.UPDATE_VAULT) {
                (IVault vault, UFixed6 depositAssets, UFixed6 redeemShares, UFixed6 claimAssets, bool wrap)
                    = abi.decode(invocation.args, (IVault, UFixed6, UFixed6, UFixed6, bool));

                _vaultUpdate(vault, depositAssets, redeemShares, claimAssets, wrap);
            } else if (invocation.action == PerennialAction.PLACE_ORDER) {
                (IMarket market, TriggerOrder memory order) = abi.decode(invocation.args, (IMarket, TriggerOrder));

                _placeOrder(msg.sender, market, order);
            } else if (invocation.action == PerennialAction.CANCEL_ORDER) {
                (IMarket market, uint256 nonce) = abi.decode(invocation.args, (IMarket, uint256));

                _cancelOrder(msg.sender, market, nonce);
            } else if (invocation.action == PerennialAction.EXEC_ORDER) {
                (address account, IMarket market, uint256 nonce) =
                    abi.decode(invocation.args, (address, IMarket, uint256));

                _executeOrder(account, market, nonce);
            } else if (invocation.action == PerennialAction.COMMIT_PRICE) {
                (address oracleProvider, uint256 version, bytes memory data) =
                    abi.decode(invocation.args, (address, uint256, bytes));

                _commitPrice(oracleProvider, version, data);
            } else if (invocation.action == PerennialAction.LIQUIDATE) {
                (IMarket market, address account) = abi.decode(invocation.args, (IMarket, address));

                _liquidate(IMarket(market), account);
            } else if (invocation.action == PerennialAction.APPROVE) {
                (address target) = abi.decode(invocation.args, (address));

                _approve(target);
            } else if (invocation.action == PerennialAction.CHARGE_FEE) {
                (address to, UFixed6 amount) = abi.decode(invocation.args, (address, UFixed6));

                USDC.pullTo(msg.sender, to, amount);
            }
        }
    }

    /// @notice Updates market on behalf of msg.sender
    /// @param market Address of market up update
    /// @param newMaker New maker position for msg.sender in `market`
    /// @param newLong New long position for msg.sender in `market`
    /// @param newShort New short position for msg.sender in `market`
    /// @param collateral Net change in collateral for msg.sender in `market`
    function _update(
        IMarket market,
        UFixed6 newMaker,
        UFixed6 newLong,
        UFixed6 newShort,
        Fixed6 collateral,
        bool wrap
    ) internal {
        // collateral is transferred from this address to the market, transfer from msg.sender to here
        if (collateral.sign() == 1) _deposit(collateral.abs(), wrap);

        market.update(msg.sender, newMaker, newLong, newShort, collateral, false);

        // collateral is transferred from the market to this address, transfer to msg.sender from here
        if (collateral.sign() == -1) _withdraw(msg.sender, collateral.abs(), wrap);
    }

    /// @notice Update vault on behalf of msg.sender
    /// @param vault Address of vault to update
    /// @param depositAssets Amount of assets to deposit into vault
    /// @param redeemShares Amount of shares to redeem from vault
    /// @param claimAssets Amount of assets to claim from vault
    /// @param wrap Whether to wrap assets before depositing
    function _vaultUpdate(
        IVault vault,
        UFixed6 depositAssets,
        UFixed6 redeemShares,
        UFixed6 claimAssets,
        bool wrap
    ) internal {
        if (!depositAssets.isZero()) {
            _deposit(depositAssets, wrap);
        }

        UFixed18 balanceBefore = DSU.balanceOf();

        vault.update(msg.sender, depositAssets, redeemShares, claimAssets);

        // handle socialization, settlement fees, and magic values
        UFixed6 claimAmount = claimAssets.isZero() ?
            UFixed6Lib.ZERO :
            UFixed6Lib.from(DSU.balanceOf().sub(balanceBefore));

        if (!claimAmount.isZero()) {
            _withdraw(msg.sender, claimAmount, wrap);
        }
    }

    /// @notice Liquidates an account for a specific market
    /// @param market Market to liquidate account in
    /// @param account Address of market to liquidate
    function _liquidate(IMarket market, address account) internal {
        UFixed6 liquidationFee = _liquidationFee(market, account);

        market.update(
            account,
            UFixed6Lib.ZERO,
            UFixed6Lib.ZERO,
            UFixed6Lib.ZERO,
            Fixed6Lib.from(-1, liquidationFee),
            true
        );

        _withdraw(msg.sender, liquidationFee, true);
    }

    /// @notice Helper to max approve DSU for usage in a market or vault deployed by the registered factories
    /// @param target Market or Vault to approve
    function _approve(address target) internal {
        if(!marketFactory.instances(IInstance(target)) && !vaultFactory.instances(IInstance(target)))
            revert MultiInvokerInvalidApprovalError();
        DSU.approve(target);
    }

    /// @notice Pull DSU or wrap and deposit USDC from msg.sender to this address for market usage
    /// @param amount Amount to transfer
    /// @param wrap Flag to wrap USDC to DSU
    function _deposit(UFixed6 amount, bool wrap) internal {
        if (wrap) {
            USDC.pull(msg.sender, amount);
            _wrap(address(this), UFixed18Lib.from(amount));
        } else {
            DSU.pull(msg.sender, UFixed18Lib.from(amount));
        }
    }

    /// @notice Push DSU or unwrap DSU to push USDC from this address to `account`
    /// @param account Account to push DSU or USDC to
    /// @param amount Amount to transfer
    /// @param wrap flag to unwrap DSU to USDC
    function _withdraw(address account, UFixed6 amount, bool wrap) internal {
        if (wrap) {
            _unwrap(account, UFixed18Lib.from(amount));
        } else {
            DSU.push(account, UFixed18Lib.from(amount));
        }
    }

    /// @notice Helper function to wrap `amount` USDC from `msg.sender` into DSU using the batcher or reserve
    /// @param receiver Address to receive the DSU
    /// @param amount Amount of USDC to wrap
    function _wrap(address receiver, UFixed18 amount) internal {
        // If the batcher is 0 or  doesn't have enough for this wrap, go directly to the reserve
        if (address(batcher) == address(0) || amount.gt(DSU.balanceOf(address(batcher)))) {
            reserve.mint(amount);
            if (receiver != address(this)) DSU.push(receiver, amount);
        } else {
            // Wrap the USDC into DSU and return to the receiver
            batcher.wrap(amount, receiver);
        }
    }

    /// @notice Helper function to unwrap `amount` DSU into USDC and send to `receiver`
    /// @param receiver Address to receive the USDC
    /// @param amount Amount of DSU to unwrap
    function _unwrap(address receiver, UFixed18 amount) internal {
        // If the batcher is 0 or doesn't have enough for this unwrap, go directly to the reserve
        if (address(batcher) == address(0) || amount.gt(UFixed18Lib.from(USDC.balanceOf(address(batcher))))) {
            reserve.redeem(amount);
            if (receiver != address(this)) USDC.push(receiver, UFixed6Lib.from(amount));
        } else {
            // Unwrap the DSU into USDC and return to the receiver
            batcher.unwrap(amount, receiver);
        }
    }

    /// @notice Helper function to commit a price to an oracle
    /// @param oracleProvider Address of oracle provider
    /// @param version Version of oracle to commit to
    /// @param data Data to commit to oracle
    function _commitPrice(address oracleProvider, uint256 version, bytes memory data) internal {
        UFixed18 balanceBefore = DSU.balanceOf();

        IPythOracle(oracleProvider).commit{value: msg.value}(version, data);

        // Return through keeper reward if any
        DSU.push(msg.sender, DSU.balanceOf().sub(balanceBefore));
    }

    /// @notice Helper function to compute the liquidation fee for an account
    /// @param market Market to compute liquidation fee for
    /// @param account Account to compute liquidation fee for
    /// @return liquidationFee Liquidation fee for the account
    function _liquidationFee(IMarket market, address account) internal view returns (UFixed6) {
        RiskParameter memory riskParameter = market.riskParameter();
        (Position memory latestPosition, OracleVersion memory latestVersion) = _latest(market, account);

        return latestPosition
            .liquidationFee(latestVersion, riskParameter)
            .min(UFixed6Lib.from(market.token().balanceOf(address(market))));
    }

    /// @notice Helper function to compute the latest position and oracle version without a settlement
    /// @param market Market to compute latest position and oracle version for
    /// @param account Account to compute latest position and oracle version for
    /// @return latestPosition Latest position for the account
    /// @return latestVersion Latest oracle version for the account
    function _latest(
        IMarket market,
        address account
    ) internal view returns (Position memory latestPosition, OracleVersion memory latestVersion) {
        // load latest settled position and price
        uint256 latestTimestamp = market.oracle().latest().timestamp;
        latestPosition = market.positions(account);
        latestVersion = OracleVersion(latestPosition.timestamp, market.global().latestPrice, true);

        // scan pending position for any ready-to-be-settled positions
        Local memory local = market.locals(account);
        for (uint256 id = local.latestId; id <= local.currentId; id++) {
            Position memory pendingPosition = market.pendingPositions(account, id);
            OracleVersion memory oracleVersion = market.oracle().at(pendingPosition.timestamp);

            IPayoffProvider payoff = market.payoff();
            if (address(payoff) != address(0)) oracleVersion.price = payoff.payoff(oracleVersion.price);

            // if versions are valid, update latest
            if (latestTimestamp >= pendingPosition.timestamp && oracleVersion.valid) {
                latestPosition = pendingPosition;
                latestVersion = oracleVersion;
            }
        }
    }

    /**
     * @notice executes an `account's` open order for a `market` and pays a fee to `msg.sender`
     * @param account Account to execute order of
     * @param market Market to execute order for
     * @param nonce Id of open order to index
     */
    function _executeOrder(
        address account,
        IMarket market,
        uint256 nonce
    ) internal keep (
        UFixed18Lib.from(keeperMultiplier),
        GAS_BUFFER,
        abi.encode(account, market, orders(account, market, nonce).fee)
    ) {
        if (!canExecuteOrder(account, market, nonce)) revert MultiInvokerCantExecuteError();

        Position memory currentPosition = market.pendingPositions(account, market.locals(account).currentId);
        orders(account, market, nonce).execute(currentPosition);

        market.update(
            account,
            currentPosition.maker,
            currentPosition.long,
            currentPosition.short,
            Fixed6Lib.ZERO,
            false
        );

        delete _orders[account][market][nonce];
        emit OrderExecuted(account, market, nonce, market.locals(account).currentId);
    }

    /// @notice Helper function to raise keeper fee
    /// @param keeperFee Keeper fee to raise
    /// @param data Data to raise keeper fee with
    function _raiseKeeperFee(UFixed18 keeperFee, bytes memory data) internal override {
        (address account, address market, UFixed6 fee) = abi.decode(data, (address, address, UFixed6));
        if (keeperFee.gt(UFixed18Lib.from(fee))) revert MultiInvokerMaxFeeExceededError();

        IMarket(market).update(
            account,
            UFixed6Lib.MAX,
            UFixed6Lib.MAX,
            UFixed6Lib.MAX,
            Fixed6Lib.from(Fixed18Lib.from(-1, keeperFee), true),
            false
        );

    }

    /// @notice Places order on behalf of msg.sender from the invoker
    /// @param account Account to place order for
    /// @param market Market to place order in
    /// @param order Order state to place
    function _placeOrder(address account, IMarket market, TriggerOrder memory order) internal {
        if (order.fee.isZero()) revert MultiInvokerInvalidOrderError();
        if (order.comparison != -1 && order.comparison != 1) revert MultiInvokerInvalidOrderError();
        if (order.side != 1 && order.side != 2) revert MultiInvokerInvalidOrderError();

        _orders[account][market][++latestNonce].store(order);
        emit OrderPlaced(account, market, latestNonce, order);
    }

    /// @notice Cancels an open order for msg.sender
    /// @param account Account to cancel order for
    /// @param market Market order is open in
    /// @param nonce UID of order
    function _cancelOrder(address account, IMarket market, uint256 nonce) internal {
        delete _orders[account][market][nonce];
        emit OrderCancelled(account, market, nonce);
    }

    /// @notice Helper function to get price of `market`
    /// @param market Market to get price of
    /// @return price 6-decimal price of market
    function _getMarketPrice(IMarket market, address account) internal view returns (Fixed6 price) {
        (, OracleVersion memory latestVersion) = _latest(market, account);
        return latestVersion.price;
    }
}
