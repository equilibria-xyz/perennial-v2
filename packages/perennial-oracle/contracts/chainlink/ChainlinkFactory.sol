// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

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
    /// @param data The update data to validate
    /// @return prices The parsed price list if valid
    function _parsePrices(
        bytes32[] memory ids,
        bytes calldata data
    ) internal override returns (PriceRecord[] memory prices) {
        bytes[] memory verifiedReports = chainlink.verifyBulk{value: msg.value}(
            abi.decode(data, (bytes[])),
            abi.encode(feeTokenAddress)
        );
        if (verifiedReports.length != ids.length) revert ChainlinkFactoryInputLengthMismatchError();

        prices = new PriceRecord[](ids.length);
        for (uint256 i = 0; i < verifiedReports.length; i++) {
            (bytes32 feedId, , uint32 observationsTimestamp, , , , uint192 price) =
                abi.decode(verifiedReports[i], (bytes32, uint32, uint32, uint192, uint192, uint32, uint192));

            if (feedId != toUnderlyingId[ids[i]]) revert ChainlinkFactoryInvalidFeedIdError(feedId);

            prices[i] = PriceRecord(observationsTimestamp, Fixed18Lib.from(UFixed18.wrap(price)));
        }
    }

    /// @notice Returns the applicable value for the keeper fee
    /// @param data The update data to validate
    /// @return The applicable value for the keeper fee
    function _applicableValue(uint256, bytes memory data) internal view override returns (uint256) {
        bytes[] memory payloads = abi.decode(data, (bytes[]));
        uint256 totalFeeAmount = 0;
        for (uint256 i = 0; i < payloads.length; i++) {
            (, bytes memory report) = abi.decode(payloads[i], (bytes32[3], bytes));
            (Asset memory fee, ,) = feeManager.getFeeAndReward(address(this), report, feeTokenAddress);
            totalFeeAmount += fee.amount;
        }
        return totalFeeAmount;
    }
}

