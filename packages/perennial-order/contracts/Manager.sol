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

    // TODO: need a way to invalidate spent order IDs
    /// @dev Stores trigger orders while awaiting their conditions to become true
    /// Market => User => Nonce => Order
    mapping(IMarket => mapping(address => mapping(uint256 => TriggerOrderStorage))) private _orders;

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
    function initialize(AggregatorV3Interface ethOracle_, KeepConfig memory keepConfig_) external initializer(1) {
        __Kept__initialize(ethOracle_, DSU);
        keepConfig = keepConfig_;
    }

    /// @inheritdoc IManager
    function placeOrder(IMarket market, TriggerOrder calldata order, uint256 nonce) external {
        _orders[market][msg.sender][nonce].store(order);
        // TODO: invalidate the nonce through the verifier
        emit OrderPersisted(market, msg.sender, order, nonce);
    }

    /// @inheritdoc IManager
    function placeOrderWithSignature(PlaceOrderAction calldata action, bytes calldata signature) external {}

    /// @inheritdoc IManager
    function cancelOrder(IMarket market, uint256 nonce) external {
        delete _orders[market][msg.sender][nonce];
        // TODO: invalidate the nonce through the verifier
        emit OrderCancelled(market, msg.sender, nonce);
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
    function executeOrder(IMarket market, address user, uint256 nonce) external {}

    // TODO: keeper compensated as referrer; may not need this
    // function _raiseKeeperFee(UFixed18 keeperFee, bytes memory data) internal virtual override returns (UFixed18) {}
}
