// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import { IMarket } from "@perennial/v2-core/contracts/interfaces/IMarket.sol";
import { RiskParameter } from "@perennial/v2-core/contracts/types/RiskParameter.sol";
import { Ownable } from "@equilibria/root/attribute/Ownable.sol";
import { ICoordinator } from "./interfaces/ICoordinator.sol";

/// @title Coordinator
/// @notice Manages claiming fees and updating risk parameters for markets
contract Coordinator is ICoordinator, Ownable {
    /// @dev The address of the comptroller (who can claim the fee)
    address public comptroller;

    /// @dev The address of the coordinator (who can update risk parameters)
    address public coordinator;

    /// @notice Constructs the contract
    constructor() {
        __Ownable__initialize();
    }

    /// @notice Updates the comptroller
    /// @param comptroller_ The address of the new comptroller
    function setComptroller(address comptroller_) external onlyOwner {
        comptroller = comptroller_;
        emit ComptrollerSet(comptroller_);
    }

    /// @notice Updates the coordinator
    /// @param coordinator_ The address of the new coordinator
    function setCoordinator(address coordinator_) external onlyOwner {
        coordinator = coordinator_;
        emit CoordinatorSet(coordinator_);
    }

    /// @notice Claims the fee for a market
    /// @param market The market to claim the fee for
    function claimFee(IMarket market) external {
        if (msg.sender != comptroller) revert NotComptroller();
        market.claimFee(address(this));
        market.token().push(comptroller);
    }

    /// @notice Updates the risk parameter for a market
    /// @param market The market to update the risk parameter for
    /// @param riskParameter The new risk parameter
    function updateRiskParameter(IMarket market, RiskParameter calldata riskParameter) external {
        if (msg.sender != coordinator) revert NotCoordinator();
        market.updateRiskParameter(riskParameter);
    }
}
