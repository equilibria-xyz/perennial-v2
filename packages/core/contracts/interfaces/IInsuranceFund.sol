// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import { IOwnable } from "@equilibria/root/attribute/interfaces/IOwnable.sol";
import { Token18 } from "@equilibria/root/token/types/Token18.sol";
import { UFixed18 } from "@equilibria/root/number/types/UFixed18.sol";

interface IInsuranceFund is IOwnable {
    error InsuranceFundInvalidAddress();
    error InsuranceFundInvalidAmount();

    function initialize(address, Token18) external;
    function claimFees(address) external;
    function resolveShortfall(address) external;
    function sendDSUToMarket(address, UFixed18) external;
    function withdrawDSU(UFixed18) external;
}