// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { IEmptySetReserve } from "@equilibria/emptyset-batcher/interfaces/IEmptySetReserve.sol";
import { AggregatorV3Interface, Kept, Token18 } from "@equilibria/root/attribute/Kept/Kept.sol";
import { Fixed6, Fixed6Lib } from "@equilibria/root/number/types/Fixed6.sol";
import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { UFixed18, UFixed18Lib } from "@equilibria/root/number/types/UFixed18.sol";
import { Token6 } from "@equilibria/root/token/types/Token6.sol";
import { IMarket, IMarketFactory } from "@equilibria/perennial-v2/contracts/interfaces/IMarketFactory.sol";

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

    /// @dev Contract used to validate delegated signers
    IMarketFactory public immutable marketFactory;

    /// @dev Verifies EIP712 messages for this extension
    IOrderVerifier public immutable verifier;

    /// @dev Configuration used for keeper compensation
    KeepConfig public keepConfig;

    /// @dev Configuration used to compensate keepers for price commitments
    KeepConfig public keepConfigBuffered;

    /// @dev Stores trigger orders while awaiting their conditions to become true
    /// Market => Account => Nonce => Order
    mapping(IMarket => mapping(address => mapping(uint256 => TriggerOrderStorage))) private _orders;

    /// @dev Creates an instance
    /// @param dsu_ Digital Standard Unit stablecoin
    /// @param marketFactory_ Contract used to validate delegated signers
    constructor(
        Token6 usdc_,
        Token18 dsu_,
        IEmptySetReserve reserve_,
        IMarketFactory marketFactory_,
        IOrderVerifier verifier_
    ) {
        USDC = usdc_;
        DSU = dsu_;
        reserve = reserve_;
        marketFactory = marketFactory_;
        verifier = verifier_;
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
        _ensureValidSigner(request.action.common.account, request.action.common.signer);

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
        _ensureValidSigner(request.action.common.account, request.action.common.signer);

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

        order.execute(market, account);
        bool interfaceFeeCharged = _chargeInterfaceFee(market, account, order);

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

    /// @notice reverts if user is not authorized to sign transactions for the account
    function _ensureValidSigner(address account, address signer) internal view {
        if (account != signer && !marketFactory.signers(account, signer)) revert ManagerInvalidSignerError();
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

        _marketWithdraw(market, account, raisedKeeperFee);

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

        _marketWithdraw(market, account, feeAmount);

        if (order.interfaceFee.unwrap) _unwrapAndWithdraw(order.interfaceFee.receiver, UFixed18Lib.from(feeAmount));
        else DSU.push(order.interfaceFee.receiver, UFixed18Lib.from(feeAmount));

        return true;
    }

    /// @notice Transfers DSU from market to manager to pay keeper or interface fee
    function _marketWithdraw(IMarket market, address account, UFixed6 amount) private {
        market.update(account, UFixed6Lib.MAX, UFixed6Lib.MAX, UFixed6Lib.MAX, Fixed6Lib.from(-1, amount), false);
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
        reserve.redeem(amount);
        USDC.push(receiver, UFixed6Lib.from(amount));
    }

    modifier keepAction(Action calldata action, bytes memory applicableCalldata) {
        bytes memory data = abi.encode(action.market, action.common.account, action.maxFee);

        uint256 startGas = gasleft();
        _;
        uint256 applicableGas = startGas - gasleft();

        _handleKeeperFee(keepConfig, applicableGas, applicableCalldata, 0, data);
    }
}
