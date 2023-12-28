// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;
import {
    IFactory,
    IMarket,
    Position,
    Local,
    UFixed18Lib,
    UFixed18,
    OracleVersion,
    RiskParameter
} from "@equilibria/perennial-v2/contracts/interfaces/IMarket.sol";
import { IBatcher } from "@equilibria/emptyset-batcher/interfaces/IBatcher.sol";
import { IEmptySetReserve } from "@equilibria/emptyset-batcher/interfaces/IEmptySetReserve.sol";
import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { Fixed6, Fixed6Lib } from "@equilibria/root/number/types/Fixed6.sol";
import { Token6 } from "@equilibria/root/token/types/Token6.sol";
import { Token18 } from "@equilibria/root/token/types/Token18.sol";
import { TriggerOrder } from "../types/TriggerOrder.sol";
import { InterfaceFee } from "../types/InterfaceFee.sol";

interface IMultiInvoker {
    enum PerennialAction {
        NO_OP,           // 0
        UPDATE_POSITION, // 1
        UPDATE_VAULT,    // 2
        PLACE_ORDER,     // 3
        CANCEL_ORDER,    // 4
        EXEC_ORDER,      // 5
        COMMIT_PRICE,    // 6
        __LIQUIDATE__DEPRECATED,
        APPROVE          // 8
    }

    struct Invocation {
        PerennialAction action;
        bytes args;
    }

    event KeeperFeeCharged(address indexed account, address indexed market, address indexed to, UFixed6 fee);
    event OrderPlaced(address indexed account, IMarket indexed market, uint256 indexed nonce, TriggerOrder order);
    event OrderExecuted(address indexed account, IMarket indexed market, uint256 nonce);
    event OrderCancelled(address indexed account, IMarket indexed market, uint256 nonce);
    event InterfaceFeeCharged(address indexed account, IMarket indexed market, InterfaceFee fee);

    // sig: 0x217b1699
    error MultiInvokerBadSenderError();
    // sig: 0x88d67968
    error MultiInvokerOrderMustBeSingleSidedError();
    // sig: 0xbccd78e7
    error MultiInvokerMaxFeeExceededError();
    // sig: 0x47b7c1b0
    error MultiInvokerInvalidInstanceError();
    // sig: 0xb6befb58
    error MultiInvokerInvalidOrderError();
    // sig: 0x6f462962
    error MultiInvokerCantExecuteError();

    function invoke(Invocation[] calldata invocations) external payable;
    function marketFactory() external view returns (IFactory);
    function vaultFactory() external view returns (IFactory);
    function batcher() external view returns (IBatcher);
    function reserve() external view returns (IEmptySetReserve);
    function keepBufferBase() external view returns (uint256);
    function keepBufferCalldata() external view returns (uint256);
    function latestNonce() external view returns (uint256);
    function orders(address account, IMarket market, uint256 nonce) external view returns (TriggerOrder memory);
    function canExecuteOrder(address account, IMarket market, uint256 nonce) external view returns (bool);
}