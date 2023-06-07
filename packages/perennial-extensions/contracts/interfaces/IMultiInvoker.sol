pragma solidity ^0.8.13;
import { IMarket, Position, Local, UFixed18Lib, UFixed18 } from "@equilibria/perennial-v2/contracts/interfaces/IMarket.sol";
import { UFixed6, UFixed6Lib } from "@equilibria/root-v2/contracts/UFixed6.sol";
import { Fixed6, Fixed6Lib } from "@equilibria/root-v2/contracts/Fixed6.sol";
import { Token6 } from "@equilibria/root/token/types/Token6.sol";
import { Token18 } from "@equilibria/root/token/types/Token18.sol";
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
        PLACE_ORDER,
        UPDATE_ORDER,
        CANCEL_ORDER,
        EXEC_ORDER
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

    error MultiInvoker_Invoke_BadSender();
    error MultiInvoker_PlaceOrder_OrderMustBeSingleSided();
    error MultiInvoker_ExecuteOrder_MaxFeeExceeded();
    
    function invoke(Invocation[] calldata invocations) external;

}