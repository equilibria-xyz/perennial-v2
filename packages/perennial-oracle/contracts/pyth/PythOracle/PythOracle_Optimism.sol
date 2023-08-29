// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "@equilibria/root/attribute/Kept/Kept_Optimism.sol";
import "./PythOracleBase.sol";

/// @title PythOracle_Optimism
/// @notice Optimism Kept Oracle implementation for Pyth price feeds.
/// @dev Additionally incentivizes keepers with L1 rollup fees according to the Optimism spec
contract PythOracle_Optimism is PythOracleBase, Kept_Optimism {
    constructor(AbstractPyth _pyth) PythOracleBase(_pyth) {}

    /// @notice Initializes the contract state
    /// @param id_ price ID for Pyth price feed
    /// @param chainlinkFeed_ Chainlink price feed for rewarding keeper in DSU
    /// @param dsu_ Token to pay the keeper reward in
    function initialize(bytes32 id_, AggregatorV3Interface chainlinkFeed_, Token18 dsu_) external initializer(1) {
        super.__UKept__initialize(chainlinkFeed_, dsu_);
        super.__PythOracleBase__initialize(id_);
    }

    /// @notice Raises the keeper fee
    /// @param keeperFee The keeper fee to pull
    function _raiseKeeperFee(UFixed18 keeperFee, bytes memory) internal override {
        super._claimAndSendKeeperFee(keeperFee);
    }

    /// @notice Commits the price represented by `updateData` to the next version that needs to be committed
    /// @dev Passthrough to the super contract, adding the `keep` modifier
    /// @param versionIndex The index of the version to commit
    /// @param updateData The update data to commit
    function commitRequested(
        uint256 versionIndex,
        bytes calldata updateData
    ) public payable override keep(KEEPER_REWARD_PREMIUM, KEEPER_BUFFER, updateData, "") {
        super.commitRequested(versionIndex, updateData);
    }
}
