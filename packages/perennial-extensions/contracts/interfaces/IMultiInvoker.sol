// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;
import {
    IMarket,
    IPayoffProvider,
    Position,
    Local,
    UFixed18Lib,
    UFixed18,
    OracleVersion,
    RiskParameter
} from "@equilibria/perennial-v2/contracts/interfaces/IMarket.sol";
import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { Fixed6, Fixed6Lib } from "@equilibria/root/number/types/Fixed6.sol";
import { Token6 } from "@equilibria/root/token/types/Token6.sol";
import { Token18 } from "@equilibria/root/token/types/Token18.sol";

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
        APPROVE_MARKET,
        VAULT_UPDATE, // @todo change tuple order in tests
        CHARGE_FEE
    }

    struct KeeperOrder {
        UFixed6 limitPrice;
        UFixed6 takeProfit;
        UFixed6 stopLoss;
        bool isLong;
        uint8 maxFee;
    }

    struct Invocation {
        PerennialAction action;
        bytes args;
    }

    event KeeperFeeCharged(address indexed account, address indexed market, address indexed to, UFixed6 fee);

    error MultiInvokerBadSenderError();
    error MultiInvokerOrderMustBeSingleSidedError();
    error MultiInvokerMaxFeeExceededError();
    error MultiInvokerInvalidApprovalError();

    function invoke(Invocation[] calldata invocations) external;

}