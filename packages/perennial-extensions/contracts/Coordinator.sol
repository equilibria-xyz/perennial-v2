// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import { Ownable } from "@equilibria/root/attribute/Ownable.sol";
import { ICoordinator, IMarket, RiskParameter, Token18 } from "./interfaces/ICoordinator.sol";

/// @title Coordinator
/// @notice Manages claiming fees and updating risk parameters for markets
contract Coordinator is ICoordinator, Ownable {
    /// @dev The address of the fee claimer
    address public feeClaimer;

    /// @dev The address of the risk parameter updater
    address public riskParameterUpdater;

    /// @notice Constructs the contract
    constructor() {
        __Ownable__initialize();
    }

    /// @notice Updates the fee claimer
    /// @param feeClaimer_ The address of the new fee claimer
    function setFeeClaimer(address feeClaimer_) external onlyOwner {
        feeClaimer = feeClaimer_;
        emit FeeClaimerSet(feeClaimer_);
    }

    /// @notice Updates the risk parameter updater
    /// @param riskParameterUpdater_ The address of the new risk parameter updater
    function setRiskParameterUpdater(address riskParameterUpdater_) external onlyOwner {
        riskParameterUpdater = riskParameterUpdater_;
        emit RiskParameterUpdaterSet(riskParameterUpdater_);
    }

    /// @notice Claims the fee for a market
    /// @param market The market to claim the fee for
    function claimFee(IMarket market) external {
        if (msg.sender != feeClaimer) revert NotFeeClaimer();
        market.claimFee();
        Token18 token = market.token();
        token.push(feeClaimer, token.balanceOf());
    }

    /// @notice Updates the risk parameter for a market
    /// @param market The market to update the risk parameter for
    /// @param riskParameter The new risk parameter
    function updateRiskParameter(IMarket market, RiskParameter calldata riskParameter) external {
        if (msg.sender != riskParameterUpdater) revert NotRiskParameterUpdater();
        market.updateRiskParameter(riskParameter);
    }
}
