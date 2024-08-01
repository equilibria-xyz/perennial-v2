// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { AggregatorV3Interface, Kept, Token18 } from "@equilibria/root/attribute/Kept/Kept.sol";
import { Fixed6, Fixed6Lib } from "@equilibria/root/number/types/Fixed6.sol";
import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { UFixed18, UFixed18Lib } from "@equilibria/root/number/types/UFixed18.sol";
import {
    IMarket,
    IMarketFactory,
    Order,
    Position
} from "@equilibria/perennial-v2/contracts/interfaces/IMarketFactory.sol";

import { IManager } from "./interfaces/IManager.sol";
import { IOrderVerifier } from "./interfaces/IOrderVerifier.sol";
import { CancelOrderAction } from "./types/CancelOrderAction.sol";
import { TriggerOrder, TriggerOrderStorage } from "./types/TriggerOrder.sol";
import { PlaceOrderAction } from "./types/PlaceOrderAction.sol";

/// @notice Base class with business logic to store and execute trigger orders.
///         Derived implementations created as appropriate for different chains.
abstract contract Manager is IManager, Kept {
    /// @dev Digital Standard Unit token used for keeper compensation
    Token18 public immutable DSU; // solhint-disable-line var-name-mixedcase

    /// @dev Configuration used for keeper compensation
    KeepConfig public keepConfig;

    /// @dev Contract used to validate delegated signers
    IMarketFactory public marketFactory;

    /// @dev Verifies EIP712 messages for this extension
    IOrderVerifier public verifier;

    /// @dev Stores trigger orders while awaiting their conditions to become true
    /// Market => User => Nonce => Order
    mapping(IMarket => mapping(address => mapping(uint256 => TriggerOrderStorage))) private _orders;

    /// @dev Prevents user from reusing orderIds
    /// User => Nonce => true if spent
    mapping(address => mapping(uint256 => bool)) private _spentOrderIds;

    // TODO: will also need a _spentGroupIds mapping upon implementing the feature

    /// @dev Creates an instance
    /// @param dsu_ Digital Standard Unit stablecoin
    /// @param marketFactory_ Contract used to validate delegated signers
    constructor(Token18 dsu_, IMarketFactory marketFactory_, IOrderVerifier verifier_) {
        DSU = dsu_;
        marketFactory = marketFactory_;
        verifier = verifier_;
    }

    /// @notice Initialize the contract
    /// @param ethOracle_ Chainlink ETH/USD oracle used for keeper compensation
    /// @param keepConfig_ Keeper compensation configuration
    function initialize(
        AggregatorV3Interface ethOracle_,
        KeepConfig memory keepConfig_
    ) external initializer(1) {
        __Kept__initialize(ethOracle_, DSU);
        keepConfig = keepConfig_;
    }

    /// @inheritdoc IManager
    function placeOrder(IMarket market, uint256 orderNonce, TriggerOrder calldata order) external {
        _placeOrder(market, msg.sender, orderNonce, order);
    }

    /// @inheritdoc IManager
    function placeOrderWithSignature(PlaceOrderAction calldata action, bytes calldata signature) external {
        // ensure the message was signed by the owner or a delegated signer
        verifier.verifyPlaceOrder(action, signature);
        _ensureValidSigner(action.action.common.account, action.action.common.signer);

        _placeOrder(action.action.market, action.action.common.account, action.action.orderNonce, action.order);
    }

    /// @inheritdoc IManager
    function cancelOrder(IMarket market, uint256 orderNonce) external {
        _cancelOrder(market, msg.sender, orderNonce);
    }

    /// @inheritdoc IManager
    function cancelOrderWithSignature(CancelOrderAction calldata action, bytes calldata signature) external {
        // ensure the message was signed by the owner or a delegated signer
        verifier.verifyCancelOrder(action, signature);
        _ensureValidSigner(action.action.common.account, action.action.common.signer);

        _cancelOrder(action.action.market, action.action.common.account, action.action.orderNonce);
    }

    /// @inheritdoc IManager
    function orders(IMarket market, address user, uint256 orderNonce) external view returns (TriggerOrder memory) {
        return _orders[market][user][orderNonce].read();
    }

    /// @inheritdoc IManager
    function checkOrder(
        IMarket market,
        address user,
        uint256 orderNonce
    ) public view returns (TriggerOrder memory order, bool canExecute) {
        order = _orders[market][user][orderNonce].read();
        canExecute = order.canExecute(market.oracle().latest());
    }

    /// @inheritdoc IManager
    function executeOrder(IMarket market, address user, uint256 orderNonce) external {
        // check conditions to ensure order is executable
        (TriggerOrder memory order, bool canExecute) = checkOrder(market, user, orderNonce);
        if (!canExecute) revert ManagerCannotExecuteError();

        // settle and get the pending position of the account
        market.settle(user);
        // TODO: move this logic into TriggerOrder?
        Order memory pending = market.pendings(user);
        Position memory currentPosition = market.positions(user);
        currentPosition.update(pending);
        order.execute(market, user, currentPosition);

        delete _orders[market][user][orderNonce];
        _spentOrderIds[user][orderNonce] = true;

        emit OrderExecuted(market, user, order, orderNonce);
    }

    /// @dev reverts if user is not authorized to sign transactions for the user
    function _ensureValidSigner(address user, address signer) internal view {
        if (user != signer && !marketFactory.signers(user, signer)) revert ManagerInvalidSignerError();
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

        market.update(
            account,
            UFixed6Lib.MAX,
            UFixed6Lib.MAX,
            UFixed6Lib.MAX,
            Fixed6Lib.from(-1, raisedKeeperFee),
            false
        );

        return UFixed18Lib.from(raisedKeeperFee);
    }

    function _cancelOrder(IMarket market, address user, uint256 orderNonce) private
    {
        // ensure this order wasn't already executed/cancelled
        TriggerOrder memory order = _orders[market][user][orderNonce].read();
        if (order.isEmpty()) revert ManagerCannotCancelError();

        // free storage and invalidate the order nonce
        delete _orders[market][user][orderNonce];
        _spentOrderIds[user][orderNonce] = true;
        emit OrderCancelled(market, user, orderNonce);
    }

    function _placeOrder(IMarket market, address user, uint256 orderNonce, TriggerOrder calldata order) private
    {
        // prevent user from reusing an order identifier
        if (_spentOrderIds[user][orderNonce]) revert ManagerInvalidOrderNonceError();

        _orders[market][user][orderNonce].store(order);
        emit OrderPlaced(market, user, order, orderNonce);
    }

}
