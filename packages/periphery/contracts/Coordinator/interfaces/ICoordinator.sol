// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { IMarket } from "@perennial/v2-core/contracts/interfaces/IMarket.sol";
import { RiskParameter } from "@perennial/v2-core/contracts/types/RiskParameter.sol";

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
