// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { UFixed18 } from "@equilibria/root/number/types/UFixed18.sol";
import { Fixed18Lib } from "@equilibria/root/number/types/Fixed18.sol";
import { IGasOracle } from "@equilibria/root/gas/GasOracle.sol";
import { IChainlinkFactory, IVerifierProxy, IFeeManager } from "../interfaces/IChainlinkFactory.sol";
import { KeeperFactory } from "../keeper/KeeperFactory.sol";

/// @title ChainlinkFactory
/// @notice Factory contract for creating and managing Chainlink oracles
contract ChainlinkFactory is IChainlinkFactory, KeeperFactory {
    uint256 private constant PERCENTAGE_SCALAR = 1e18;
    string public constant factoryType = "ChainlinkFactory";

    /// @dev Chainlink verifier contract
    IVerifierProxy public immutable chainlink;

    /// @dev Chainlink fee manager contract
    IFeeManager public immutable feeManager;

    /// @dev Fee token address
    address public immutable feeTokenAddress;

    /// @notice Initializes the immutable contract state
    /// @param chainlink_ Chainlink verifier contract
    /// @param feeManager_ Chainlink fee manager contract
    /// @param feeTokenAddress_ Fee token address
    /// @param commitmentGasOracle_ Commitment gas oracle contract
    /// @param settlementGasOracle_ Settlement gas oracle contract
    /// @param implementation_ IKeeperOracle implementation contract
    constructor(
        IVerifierProxy chainlink_,
        IFeeManager feeManager_,
        address feeTokenAddress_,
        IGasOracle commitmentGasOracle_,
        IGasOracle settlementGasOracle_,
        address implementation_
    ) KeeperFactory(commitmentGasOracle_, settlementGasOracle_, implementation_) {
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
            (bytes32 feedId, , uint32 observationsTimestamp, uint192 nativeQuantity, , , uint192 price) =
                abi.decode(verifiedReports[i], (bytes32, uint32, uint32, uint192, uint192, uint32, uint192));

            if (feedId != toUnderlyingId[ids[i]]) revert ChainlinkFactoryInvalidFeedIdError(feedId);

            prices[i] = PriceRecord(
                observationsTimestamp,
                Fixed18Lib.from(UFixed18.wrap(price)),
                _commitmentPrice(feedId, nativeQuantity)
            );
        }
    }

    function _commitmentPrice(bytes32 underlyingId, uint256 nativeQuantity) internal view returns (uint256) {
        // see FeeManager.getFeeAndReward()
        // https://sepolia.arbiscan.io/address/0x226D04b3a60beE1C2d522F63a87340220b8F9D6B#code
        uint256 discount = feeManager.s_subscriberDiscounts(address(this), underlyingId, feeTokenAddress);
        uint256 surchargedFee = Math.ceilDiv(nativeQuantity * (PERCENTAGE_SCALAR + feeManager.s_nativeSurcharge()), PERCENTAGE_SCALAR);
        return Math.ceilDiv(surchargedFee * (PERCENTAGE_SCALAR - discount), PERCENTAGE_SCALAR);
    }
}

