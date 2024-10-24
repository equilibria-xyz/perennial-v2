// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { IKeeperFactory } from "./IKeeperFactory.sol";

interface IChainlinkFactory is IKeeperFactory {
    error ChainlinkFactoryInputLengthMismatchError();
    error ChainlinkFactoryInvalidFeedIdError(bytes32 feedId);
}

interface IVerifierProxy {
  /**
   * @notice Verifies that the data encoded has been signed
   * correctly by routing to the correct verifier, and bills the user if applicable.
   * @param payload The encoded data to be verified, including the signed
   * report.
   * @param parameterPayload fee metadata for billing. For the current implementation this is just the abi-encoded fee token ERC-20 address
   * @return verifierResponse The encoded report from the verifier.
   */
  function verify(
    bytes calldata payload,
    bytes calldata parameterPayload
  ) external payable returns (bytes memory verifierResponse);

  /**
   * @notice Bulk verifies that the data encoded has been signed
   * correctly by routing to the correct verifier, and bills the user if applicable.
   * @param payloads The encoded payloads to be verified, including the signed
   * report.
   * @param parameterPayload fee metadata for billing. For the current implementation this is just the abi-encoded fee token ERC-20 address
   * @return verifiedReports The encoded reports from the verifier.
   */
  function verifyBulk(
    bytes[] calldata payloads,
    bytes calldata parameterPayload
  ) external payable returns (bytes[] memory verifiedReports);
}

/// @notice The asset struct to hold the address of an asset and amount
struct Asset {
  address assetAddress;
  uint256 amount;
}

interface IFeeManager {
  /**
   * @notice Calculate the applied fee and the reward from a report. If the sender is a subscriber, they will receive a discount.
   * @param subscriber address trying to verify
   * @param report report to calculate the fee for
   * @param quoteAddress address of the quote payment token
   * @return (fee, reward, totalDiscount) fee and the reward data with the discount applied
   */
  function getFeeAndReward(
    address subscriber,
    bytes memory report,
    address quoteAddress
  ) external view returns (Asset memory, Asset memory, uint256);

  function s_nativeSurcharge() external view returns (uint256);
  function s_subscriberDiscounts(address subscriber, bytes32 feedId, address feeToken) external view returns (uint256);
}
