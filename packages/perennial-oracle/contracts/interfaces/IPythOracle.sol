// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/attribute/interfaces/IInstance.sol";
import "@equilibria/root/attribute/interfaces/IKept.sol";
import "@equilibria/perennial-v2/contracts/interfaces/IOracleProvider.sol";

interface IPythOracle is IOracleProvider, IInstance, IKept {
    // sig: 0xfd13d773
    error PythOracleInvalidPriceIdError(bytes32 id);
    // sig: 0x2dd6680d
    error PythOracleNoNewVersionToCommitError();
    // sig: 0xe28e1ef4
    error PythOracleVersionIndexTooLowError();
    // sig: 0x7c423d41
    error PythOracleGracePeriodHasNotExpiredError();
    // sig: 0x8260a7e8
    error PythOracleUpdateValidForPreviousVersionError();
    // sig: 0xf0db44e4
    error PythOracleNonIncreasingPublishTimes();
    // sig: 0xb9b9867d
    error PythOracleFailedToCalculateRewardError();
    // sig: 0x95110cb6
    error PythOracleFailedToSendRewardError();
    // sig: 0x9b4e67d3
    error PythOracleVersionOutsideRangeError();
    // sig: 0xbe244fc8
    error PythOracleNonRequestedTooRecentError();

    function initialize(bytes32 id_, AggregatorV3Interface chainlinkFeed_, Token18 dsu_) external;
    function commitRequested(uint256 versionIndex, bytes calldata updateData) external payable;
    function commit(uint256 versionIndex, uint256 oracleVersion, bytes calldata updateData) external payable;

    function MIN_VALID_TIME_AFTER_VERSION() external view returns (uint256);
    function MAX_VALID_TIME_AFTER_VERSION() external view returns (uint256);
    function GRACE_PERIOD() external view returns (uint256);
    function KEEPER_REWARD_PREMIUM() external view returns (UFixed18);
    function KEEPER_BUFFER() external view returns (uint256);
    function versionList(uint256 versionIndex) external view returns (uint256);
    function versionListLength() external view returns (uint256);
    function nextVersionIndexToCommit() external view returns (uint256);
    function nextVersionToCommit() external view returns (uint256);
}

/// @dev PythStaticFee interface, this is not exposed in the AbstractPyth contract
interface IPythStaticFee {
    function singleUpdateFeeInWei() external view returns (uint);
}
