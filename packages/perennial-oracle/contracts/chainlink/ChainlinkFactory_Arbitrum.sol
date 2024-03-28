// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import "@equilibria/root/attribute/Kept/Kept_Arbitrum.sol";
import "./ChainlinkFactory.sol";
import "../keeper/KeeperFactory.sol";

/// @title ChainlinkFactory_Arbitrum
/// @notice Arbitrum Kept Oracle implementation for Chainlink price feeds.
/// @dev Additionally incentivizes keepers with L1 rollup fees according to the Arbitrum spec
contract ChainlinkFactory_Arbitrum is ChainlinkFactory, Kept_Arbitrum {
    constructor(
        IVerifierProxy chainlink_,
        IFeeManager feeManager_,
        address feeTokenAddress_,
        address implementation_,
        uint256 validFrom_,
        uint256 validTo_,
        KeepConfig memory commitKeepConfig_,
        KeepConfig memory settleKeepConfig_,
        uint256 keepCommitIncrementalBufferData_
    ) ChainlinkFactory(chainlink_, feeManager_, feeTokenAddress_, implementation_, validFrom_, validTo_, commitKeepConfig_, settleKeepConfig_, keepCommitIncrementalBufferData_) { }

    /// @dev Use the Kept_Arbitrum implementation for calculating the dynamic fee
    function _calldataFee(
        bytes memory applicableCalldata,
        UFixed18 multiplierCalldata,
        uint256 bufferCalldata
    ) internal view virtual override(Kept_Arbitrum, Kept) returns (UFixed18) {
        return Kept_Arbitrum._calldataFee(applicableCalldata, multiplierCalldata, bufferCalldata);
    }

    /// @dev Use the ChainlinkFactory implementation for raising the keeper fee
    function _raiseKeeperFee(
        UFixed18 amount,
        bytes memory data
    ) internal override(KeeperFactory, Kept) returns (UFixed18) {
        return KeeperFactory._raiseKeeperFee(amount, data);
    }
}
