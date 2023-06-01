pragma solidity ^0.8.13;
import { IMarket, Position, Local } from "@equilibria/perennial-v2/contracts/interfaces/IMarket.sol";
import { UFixed6, UFixed6Lib } from "@equilibria/root-v2/contracts/UFixed6.sol";
interface IMultiInvoker {
    enum PerennialAction {
        NO_OP,
        DEPOSIT,
        WITHDRAW,
        UPDATE,
        CLAIM,
        WRAP,
        UNWRAP,
        WRAP_AND_UPDATE,
        UPDATE_AND_UNWRAP,
        VAULT_DEPOSIT,
        VAULT_REDEEM,
        VAULT_CLAIM,
        VAULT_WRAP_AND_DEPOSIT,
        CHARGE_FEE,
        OPEN_ORDER,
        MODIFY_ORDER,
        CANCEL_ORDER,
        CLOSE_ORDER
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

    error MultiInvoker_Invoke_BadSender();
    error MultiInvoker_PlaceOrder_OrderMustBeSingleSided();
    
    function invoke(Invocation[] calldata invocations) external;

}