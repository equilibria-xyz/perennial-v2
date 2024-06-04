// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Token18 } from "@equilibria/root/token/types/Token18.sol";
import { IMarket, RiskParameter } from "@equilibria/perennial-v2/contracts/interfaces/IMarket.sol";

interface ICoordinator {
    function setComptroller(address comptroller) external;
    function setCoordinator(address coordinator) external;
    function claimFee(IMarket market) external;
    function updateRiskParameter(IMarket market, RiskParameter calldata riskParameter) external;

    event ComptrollerSet(address comptroller);
    event CoordinatorSet(address coordinator);

    error NotComptroller();
    error NotCoordinator();
    error NotFeeWithdrawer();
}
