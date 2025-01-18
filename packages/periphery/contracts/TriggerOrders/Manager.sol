// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { IEmptySetReserve } from "@equilibria/emptyset-batcher/interfaces/IEmptySetReserve.sol";
import { AggregatorV3Interface, Kept, Token18 } from "@equilibria/root/attribute/Kept/Kept.sol";
import { Fixed6, Fixed6Lib } from "@equilibria/root/number/types/Fixed6.sol";
import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { UFixed18, UFixed18Lib } from "@equilibria/root/number/types/UFixed18.sol";
import { Token6 } from "@equilibria/root/token/types/Token6.sol";
import { IMarket, IMarketFactory } from "@perennial/v2-core/contracts/interfaces/IMarketFactory.sol";

import { IAccount, IController } from "../CollateralAccounts/interfaces/IController.sol";
import { IManager } from "./interfaces/IManager.sol";
import { IOrderVerifier } from "./interfaces/IOrderVerifier.sol";
import { Action } from "./types/Action.sol";
import { CancelOrderAction } from "./types/CancelOrderAction.sol";
import { InterfaceFee } from "./types/InterfaceFee.sol";
import { TriggerOrder, TriggerOrderStorage } from "./types/TriggerOrder.sol";
import { PlaceOrderAction } from "./types/PlaceOrderAction.sol";

/// @notice Base class with business logic to store and execute trigger orders.
///         Derived implementations created as appropriate for different chains.
abstract contract Manager is IManager, Kept {
    /// @dev USDC stablecoin address
    Token6 public immutable USDC; // solhint-disable-line var-name-mixedcase

    /// @dev Digital Standard Unit token used for keeper compensation
    Token18 public immutable DSU; // solhint-disable-line var-name-mixedcase

    /// @dev DSU Reserve address
    IEmptySetReserve public immutable reserve;

    /// @dev Contract used to validate fee claims
    IMarketFactory public immutable marketFactory;

    /// @dev Verifies EIP712 messages for this extension
    IOrderVerifier public immutable verifier;

    /// @dev Used for keeper compensation
    IController public immutable controller;

    /// @dev Configuration used for keeper compensation
    KeepConfig public keepConfig;

    /// @dev Configuration used to compensate keepers for price commitments
    KeepConfig public keepConfigBuffered;

    /// @dev Stores trigger orders while awaiting their conditions to become true
    /// Market => Account => Nonce => Order
    mapping(IMarket => mapping(address => mapping(uint256 => TriggerOrderStorage))) private _orders;

    /// @dev Mapping of claimable DSU for each account
    /// Account => Amount
    mapping(address => UFixed6) public claimable;

    /// @dev Creates an instance
    /// @param usdc_ USDC stablecoin
    /// @param dsu_ Digital Standard Unit stablecoin
    /// @param reserve_ DSU reserve contract used for unwrapping
    /// @param marketFactory_ Contract used to validate fee claims
    /// @param verifier_ Used to validate EIP712 signatures
    /// @param controller_ Collateral Account Controller used for compensating keeper and paying interface fees
    constructor(
        Token6 usdc_,
        Token18 dsu_,
        IEmptySetReserve reserve_,
        IMarketFactory marketFactory_,
        IOrderVerifier verifier_,
        IController controller_
    ) {
        USDC = usdc_;
        DSU = dsu_;
        reserve = reserve_;
        marketFactory = marketFactory_;
        verifier = verifier_;
        controller = controller_;
    }

    /// @notice Initialize the contract
    /// @param ethOracle_ Chainlink ETH/USD oracle used for keeper compensation
    /// @param keepConfig_ Keeper compensation configuration
    /// @param keepConfigBuffered_ Configuration used for price commitments
    function initialize(
        AggregatorV3Interface ethOracle_,
        KeepConfig memory keepConfig_,
        KeepConfig memory keepConfigBuffered_
    ) external initializer(1) {
        __Kept__initialize(ethOracle_, DSU);
        keepConfig = keepConfig_;
        keepConfigBuffered = keepConfigBuffered_;
        // allows DSU to unwrap to USDC
        DSU.approve(address(reserve));
    }

    /// @inheritdoc IManager
    function placeOrder(IMarket market, uint256 orderId, TriggerOrder calldata order) external {
        _placeOrder(market, msg.sender, orderId, order);
    }

    /// @inheritdoc IManager
    function placeOrderWithSignature(PlaceOrderAction calldata request, bytes calldata signature)
        external
        keepAction(request.action, abi.encode(request, signature))
    {
        // ensure the message was signed by the owner or a delegated signer
        verifier.verifyPlaceOrder(request, signature);

        _placeOrder(request.action.market, request.action.common.account, request.action.orderId, request.order);
    }

    /// @inheritdoc IManager
    function cancelOrder(IMarket market, uint256 orderId) external {
        _cancelOrder(market, msg.sender, orderId);
    }

    /// @inheritdoc IManager
    function cancelOrderWithSignature(CancelOrderAction calldata request, bytes calldata signature)
        external
        keepAction(request.action, abi.encode(request, signature))
    {
        // ensure the message was signed by the owner or a delegated signer
        verifier.verifyCancelOrder(request, signature);

        _cancelOrder(request.action.market, request.action.common.account, request.action.orderId);
    }

    /// @inheritdoc IManager
    function orders(IMarket market, address account, uint256 orderId) external view returns (TriggerOrder memory) {
        return _orders[market][account][orderId].read();
    }

    /// @inheritdoc IManager
    function checkOrder(
        IMarket market,
        address account,
        uint256 orderId
    ) public view returns (TriggerOrder memory order, bool canExecute) {
        order = _orders[market][account][orderId].read();
        // prevent calling canExecute on a spent or empty order
        if (order.isSpent || order.isEmpty()) revert ManagerInvalidOrderNonceError();
        canExecute = order.canExecute(market.oracle().latest());
    }

    /// @inheritdoc IManager
    function executeOrder(IMarket market, address account, uint256 orderId) external
    {
        // Using a modifier to measure gas would require us reading order from storage twice.
        // Instead, measure gas within the method itself.
        uint256 startGas = gasleft();

        // check conditions to ensure order is executable
        (TriggerOrder memory order, bool canExecute) = checkOrder(market, account, orderId);

        if (!canExecute) revert ManagerCannotExecuteError();

        bool interfaceFeeCharged = _chargeInterfaceFee(market, account, order);
        order.execute(market, account);

        // invalidate the order nonce
        order.isSpent = true;
        _orders[market][account][orderId].store(order);

        emit TriggerOrderExecuted(market, account, order, orderId);
        if (interfaceFeeCharged) emit TriggerOrderInterfaceFeeCharged(account, market, order.interfaceFee);

        // compensate keeper
        uint256 applicableGas = startGas - gasleft();
        bytes memory data = abi.encode(market, account, order.maxFee);
        _handleKeeperFee(keepConfigBuffered, applicableGas, abi.encode(market, account, orderId), 0, data);
    }

    /// @inheritdoc IManager
    function claim(address account, bool unwrap) external onlyOperator(account, msg.sender) {
        UFixed6 claimableAmount = claimable[account];
        claimable[account] = UFixed6Lib.ZERO;

        if (unwrap) _unwrapAndWithdraw(msg.sender, UFixed18Lib.from(claimableAmount));
        else DSU.push(msg.sender, UFixed18Lib.from(claimableAmount));
    }

    /// @notice Transfers DSU from market to manager to compensate keeper
    /// @param amount Keeper fee as calculated
    /// @param data Identifies the market from and user for which funds should be withdrawn,
    ///             and the user-defined fee cap
    /// @return Amount of funds transferred from market to manager
    function _raiseKeeperFee(
        UFixed18 amount,
        bytes memory data
    ) internal virtual override returns (UFixed18) {
        (IMarket market, address account, UFixed6 maxFee) = abi.decode(data, (IMarket, address, UFixed6));
        UFixed6 raisedKeeperFee = UFixed6Lib.from(amount, true).min(maxFee);

        _collateralAccountWithdraw(account, raisedKeeperFee);

        return UFixed18Lib.from(raisedKeeperFee);
    }

    function _cancelOrder(IMarket market, address account, uint256 orderId) private {
        // ensure this order wasn't already executed/cancelled
        TriggerOrder memory order = _orders[market][account][orderId].read();
        if (order.isEmpty() || order.isSpent) revert ManagerCannotCancelError();

        // invalidate the order nonce
        order.isSpent = true;
        _orders[market][account][orderId].store(order);

        emit TriggerOrderCancelled(market, account, orderId);
    }

    /// @notice Transfers DSU from market to manager to pay interface fee
    function _chargeInterfaceFee(IMarket market, address account, TriggerOrder memory order) internal returns (bool) {
        if (order.interfaceFee.amount.isZero()) return false;

        // determine amount of fee to charge
        UFixed6 feeAmount = order.interfaceFee.fixedFee ?
            order.interfaceFee.amount :
            order.notionalValue(market, account).mul(order.interfaceFee.amount);

        _collateralAccountWithdraw(account, feeAmount);

        claimable[order.interfaceFee.receiver] = claimable[order.interfaceFee.receiver].add(feeAmount);

        return true;
    }

    /// @dev Transfers DSU from collateral account to manager to pay fees
    /// @param account Address of the owner of the collateral account (not the account itself)
    /// @param amount Quantity of DSU to transfer, converted to 18-decimal by callee
    function _collateralAccountWithdraw(address account, UFixed6 amount) private {
        controller.chargeFee(account, amount);
    }

    function _placeOrder(IMarket market, address account, uint256 orderId, TriggerOrder calldata order) private {
        // prevent user from reusing an order identifier
        TriggerOrder memory old = _orders[market][account][orderId].read();
        if (old.isSpent) revert ManagerInvalidOrderNonceError();
        // prevent user from frontrunning keeper compensation
        if (!old.isEmpty() && old.maxFee.gt(order.maxFee)) revert ManagerCannotReduceMaxFee();

        _orders[market][account][orderId].store(order);
        emit TriggerOrderPlaced(market, account, order, orderId);
    }

    /// @notice Unwraps DSU to USDC and pushes to interface fee receiver
    function _unwrapAndWithdraw(address receiver, UFixed18 amount) private {
        UFixed6 balanceBefore = USDC.balanceOf(address(this));
        reserve.redeem(amount);
        USDC.push(receiver, USDC.balanceOf(address(this)).sub(balanceBefore));
    }

    modifier keepAction(Action calldata action, bytes memory applicableCalldata) {
        bytes memory data = abi.encode(action.market, action.common.account, action.maxFee);

        uint256 startGas = gasleft();
        _;
        uint256 applicableGas = startGas - gasleft();

        _handleKeeperFee(keepConfig, applicableGas, applicableCalldata, 0, data);
    }

    /// @notice Only the account or an operator can call
    modifier onlyOperator(address account, address operator) {
        if (account != operator && !marketFactory.operators(account, operator)) revert ManagerNotOperatorError();
        _;
    }
}
