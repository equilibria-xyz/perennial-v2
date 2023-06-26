// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root-v2/contracts/IInstance.sol";
import "./IOracleProvider.sol";

interface IPythOracle is IOracleProvider, IInstance {
    error PythOracleInvalidPriceIdError(bytes32 id);
    error PythOracleNoNewVersionToCommitError();
    error PythOracleVersionIndexTooLowError();
    error PythOracleGracePeriodHasNotExpiredError();
    error PythOracleUpdateValidForPreviousVersionError();
    error PythOracleInvalidMessageValueError();
    error PythOracleFailedToCalculateRewardError();
    error PythOracleFailedToSendRewardError();

    function initialize(bytes32 id_) external;
    function commit(uint256 versionIndex, bytes calldata updateData) external payable;
}