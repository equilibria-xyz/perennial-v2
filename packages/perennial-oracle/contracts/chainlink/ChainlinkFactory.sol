// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "../interfaces/IChainlinkFactory.sol";
import "../keeper/KeeperFactory.sol";

/// @title ChainlinkFactory
/// @notice Factory contract for creating and managing Chainlink oracles
contract ChainlinkFactory is IChainlinkFactory, KeeperFactory {
    /// @dev Chainlink verifier contract
    IVerifierProxy public immutable chainlink;

    /// @dev Chainlink fee manager contract
    IFeeManager public immutable feeManager;

    /// @dev Fee token address
    address public immutable feeTokenAddress;

    /// @notice Initializes the immutable contract state
    /// @param chainlink_ Chainlink verifier contract
    /// @param feeTokenAddress_ Fee token address
    /// @param implementation_ IKeeperOracle implementation contract
    /// @param validFrom_ The minimum time after a version that a keeper update can be valid
    /// @param validTo_ The maximum time after a version that a keeper update can be valid
    /// @param commitKeepConfig_ Parameter configuration for commit keeper incentivization
    /// @param settleKeepConfig_ Parameter configuration for settle keeper incentivization
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
    ) KeeperFactory(implementation_, validFrom_, validTo_, commitKeepConfig_, settleKeepConfig_, keepCommitIncrementalBufferData_) {
        chainlink = chainlink_;
        feeManager = feeManager_;
        feeTokenAddress = feeTokenAddress_;
    }

    /// @notice Validates and parses the update data payload against the specified version
    /// @param ids The list of price feed ids validate against
    /// @param version The oracle version to validate against
    /// @param data The update data to validate
    /// @return prices The parsed price list if valid
    function _parsePrices(
        bytes32[] memory ids,
        uint256 version,
        bytes calldata data
    ) internal override returns (Fixed6[] memory prices) {
        if (ids.length != 1) revert ChainlinkFactoryMultipleIdsError();
        prices = new Fixed6[](1);

        bytes memory verifiedReport = chainlink.verify{value: msg.value}(data, abi.encode(feeTokenAddress));
        (bytes32 feedId, , uint32 observationsTimestamp, , , , uint192 price) =
            abi.decode(verifiedReport, (bytes32, uint32, uint32, uint192, uint192, uint32, uint192));

        if (
            observationsTimestamp < version + validFrom ||
            observationsTimestamp > version + validTo
        ) revert ChainlinkFactoryVersionOutsideRangeError();
        if (feedId != toUnderlyingId[ids[0]]) revert ChainlinkFactoryInvalidFeedIdError(feedId);

        prices[0] = Fixed6Lib.from(Fixed18Lib.from(UFixed18.wrap(price)));
    }

    /// @notice Returns the applicable value for the keeper fee
    /// @param data The update data to validate
    /// @return The applicable value for the keeper fee
    function _applicableValue(uint256, bytes memory data) internal view override returns (uint256) {
        (, bytes memory report) = abi.decode(data, (bytes32[3], bytes));
        (Asset memory fee, ,) = feeManager.getFeeAndReward(address(this), report, feeTokenAddress);
        return fee.amount;
    }
}
