// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { AggregatorV3Interface, Kept, Token18 } from "@equilibria/root/attribute/Kept/Kept.sol";
import { IMarket, IMarketFactory } from "@equilibria/perennial-v2/contracts/interfaces/IMarketFactory.sol";
// import { EnumerableMap } from "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";

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
        // prevent user from reusing an order identifier
        if (_spentOrderIds[msg.sender][orderNonce]) revert ManagerInvalidOrderNonceError();

        _orders[market][msg.sender][orderNonce].store(order);
        emit OrderPlaced(market, msg.sender, order, orderNonce);
    }

    /// @inheritdoc IManager
    function placeOrderWithSignature(PlaceOrderAction calldata action, bytes calldata signature) external {}

    /// @inheritdoc IManager
    function cancelOrder(IMarket market, uint256 orderNonce) external {
        delete _orders[market][msg.sender][orderNonce];
        _spentOrderIds[msg.sender][orderNonce] = true;
        emit OrderCancelled(market, msg.sender, orderNonce);
    }

    /// @inheritdoc IManager
    function cancelOrderWithSignature(CancelOrderAction calldata action, bytes calldata signature) external {}

    /// @inheritdoc IManager
    function orders(IMarket market, address user, uint256 nonce) external view returns (TriggerOrder memory) {
        return _orders[market][user][nonce].read();
    }

    /// @inheritdoc IManager
    function checkOrder(IMarket market, address user, uint256 nonce) external returns (bool canExecute) {}

    /// @inheritdoc IManager
    function executeOrder(IMarket market, address user, uint256 nonce) external {
        // TODO: call update on the market, changing the user's position
        _spentOrderIds[msg.sender][nonce] = true;
    }

    // TODO: pull compensation from the market
    // function _raiseKeeperFee(UFixed18 keeperFee, bytes memory data) internal virtual override returns (UFixed18) {}
}
