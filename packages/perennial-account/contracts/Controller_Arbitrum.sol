// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import { Kept_Arbitrum, Kept } from "@equilibria/root/attribute/Kept/Kept_Arbitrum.sol";
import { UFixed18 } from "@equilibria/root/number/types/UFixed18.sol";
import { IVerifierBase } from "@equilibria/root/verifier/interfaces/IVerifierBase.sol";
import { IMarketFactory } from "@perennial/core/contracts/interfaces/IMarketFactory.sol";
import { Controller_Incentivized } from "./Controller_Incentivized.sol";

/// @title Controller_Arbitrum
/// @notice Controller which compensates keepers for handling or relaying messages on Arbitrum L2.
contract Controller_Arbitrum is Controller_Incentivized, Kept_Arbitrum {
    /// @dev Creates instance of Controller which compensates keepers
    /// @param implementation Pristine collateral account contract
    /// @param marketFactory Market Factory contract
    /// @param nonceManager Verifier contract to which nonce and group cancellations are relayed
    constructor(
        address implementation,
        IMarketFactory marketFactory,
        IVerifierBase nonceManager
    ) Controller_Incentivized(implementation, marketFactory, nonceManager) {}

    /// @dev Use the Kept_Arbitrum implementation for calculating the dynamic fee
    function _calldataFee(
        bytes memory applicableCalldata,
        UFixed18 multiplierCalldata,
        uint256 bufferCalldata
    ) internal view override(Kept_Arbitrum, Kept) returns (UFixed18) {
        return Kept_Arbitrum._calldataFee(applicableCalldata, multiplierCalldata, bufferCalldata);
    }

    /// @dev Transfers funds from collateral account to controller, and limits compensation
    /// to the user-defined maxFee in the Action message
    /// @param amount Calculated keeper fee
    /// @param data Encoded address of collateral account and UFixed6 user-specified maximum fee
    /// @return raisedKeeperFee Amount pulled from controller to keeper
    function _raiseKeeperFee(
        UFixed18 amount,
        bytes memory data
    ) internal override(Controller_Incentivized, Kept) returns (UFixed18 raisedKeeperFee) {
        return Controller_Incentivized._raiseKeeperFee(amount, data);
    }
}
