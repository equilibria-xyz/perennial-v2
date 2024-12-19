// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { IFactory } from "@equilibria/root/attribute/interfaces/IFactory.sol";
import { IMarket } from "@perennial/v2-core/contracts/interfaces/IMarket.sol";
import { IMarketFactory } from "@perennial/v2-core/contracts/interfaces/IMarketFactory.sol";
import { IBatcher } from "@equilibria/emptyset-batcher/interfaces/IBatcher.sol";
import { IEmptySetReserve } from "@equilibria/emptyset-batcher/interfaces/IEmptySetReserve.sol";
import { InterfaceFee } from "../types/InterfaceFee.sol";

interface IMultiInvoker {
    enum PerennialAction {
        NO_OP,           // 0
        UPDATE_POSITION, // 1
        UPDATE_VAULT,    // 2
        __PLACE_ORDER_DEPRECATED,
        __CANCEL_ORDER_DEPRECATED,
        __EXEC_ORDER_DEPRECATED,
        COMMIT_PRICE,    // 6
        __LIQUIDATE__DEPRECATED,
        APPROVE,         // 8
        UPDATE_INTENT,   // 9
        CLAIM_FEE        // 10
    }

    struct Invocation {
        PerennialAction action;
        bytes args;
    }

    event InterfaceFeeCharged(address indexed account, IMarket indexed market, InterfaceFee fee);

    // sig: 0x42ecdedb
    error MultiInvokerUnauthorizedError();
    // sig: 0x47b7c1b0
    error MultiInvokerInvalidInstanceError();

    function invoke(address account, Invocation[] calldata invocations) external payable;
    function invoke(Invocation[] calldata invocations) external payable;
    function claim(address account, bool unwrap) external;
    function marketFactory() external view returns (IMarketFactory);
    function vaultFactory() external view returns (IFactory);
    function batcher() external view returns (IBatcher);
    function reserve() external view returns (IEmptySetReserve);
}
