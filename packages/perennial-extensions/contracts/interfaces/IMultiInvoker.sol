// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;
import {
    IFactory,
    IMarket,
    IPayoffProvider,
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

interface IMultiInvoker {
    enum PerennialAction {
        NO_OP,
        UPDATE_POSITION,
        UPDATE_VAULT,
        PLACE_ORDER,
        CANCEL_ORDER,
        EXEC_ORDER,
        COMMIT_PRICE,
        LIQUIDATE,
        APPROVE,
        CHARGE_FEE
    }

    struct Invocation {
        PerennialAction action;
        bytes args;
    }

    event KeeperFeeCharged(address indexed account, address indexed market, address indexed to, UFixed6 fee);
    event OrderPlaced(address indexed account, IMarket indexed market, uint256 indexed nonce, TriggerOrder order);
    event OrderExecuted(address indexed account, IMarket indexed market, uint256 nonce, uint256 positionId);
    event OrderCancelled(address indexed account, IMarket indexed market, uint256 nonce);

    error MultiInvokerBadSenderError();
    error MultiInvokerOrderMustBeSingleSidedError();
    error MultiInvokerMaxFeeExceededError();
    error MultiInvokerInvalidApprovalError();
    error MultiInvokerInvalidOrderError();
    error MultiInvokerCantExecuteError();

    function invoke(Invocation[] calldata invocations) external payable;
    function marketFactory() external view returns (IFactory);
    function vaultFactory() external view returns (IFactory);
    function batcher() external view returns (IBatcher);
    function reserve() external view returns (IEmptySetReserve);
    function keeperMultiplier() external view returns (UFixed6);
    function latestNonce() external view returns (uint256);
    function orders(address account, IMarket market, uint256 nonce) external view returns (TriggerOrder memory);
    function canExecuteOrder(address account, IMarket market, uint256 nonce) external view returns (bool);
}