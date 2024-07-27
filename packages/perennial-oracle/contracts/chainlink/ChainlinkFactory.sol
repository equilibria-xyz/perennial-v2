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
    constructor(
        IVerifierProxy chainlink_,
        address implementation_,
        IFeeManager feeManager_,
        address feeTokenAddress_
    ) KeeperFactory(implementation_) {
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
}

