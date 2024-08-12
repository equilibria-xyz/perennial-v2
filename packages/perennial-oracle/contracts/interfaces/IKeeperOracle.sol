// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/attribute/interfaces/IInstance.sol";
import "@equilibria/perennial-v2/contracts/interfaces/IOracleProvider.sol";
import "@equilibria/perennial-v2/contracts/interfaces/IMarket.sol";
import "../Oracle.sol";
import { PriceResponse } from "../keeper/types/PriceResponse.sol";
import { PriceRequest } from "../keeper/types/PriceRequest.sol";

interface IKeeperOracle is IOracleProvider, IInstance {
    event CallbackRequested(SettlementCallback indexed callback);
    event CallbackFulfilled(SettlementCallback indexed callback);
    event OracleUpdated(IOracleProvider newOracle);

    struct SettlementCallback {
        /// @dev The market to settle
        IMarket market;

        /// @dev The account to settle
        address account;

        /// @dev The version to settle for
        uint256 version;
    }

    struct KeeperOracleGlobal {
        /// @dev The latest committed oracle version
        uint64 latestVersion;

        /// @dev Index in `versions` of the most recent version requested
        uint64 currentIndex;

        /// @dev Index in `versions` of the latest version a keeper has committed
        uint64 latestIndex;
    }

    // sig: 0xb8499c31
    error KeeperOracleVersionOutsideRangeError();
    // sig: 0xce9529c8
    error KeeperOracleInvalidPriceError();
    //sig: 0x4889ef6f
    error KeeperOracleInvalidCallbackError();
    //sig: 0x7321f78c
    error KeeperOracleNoPriorRequestsError();
    //sig: 0xdcfc48f1
    error KeeperOracleNotOracleError();

    function initialize() external;
    function register(IOracle newOracle) external;
    function commit(OracleVersion memory version, address receiver) external;
    function settle(uint256 version, uint256 maxCount) external;
    function next() external view returns (uint256);
    function localCallbacks(uint256 version) external view returns (address[] memory);

    function timeout() external view returns (uint256);
    function oracle() external view returns (IOracle);
    function requests(uint256 index) external view returns (PriceRequest memory);
    function responses(uint256 timestamp) external view returns (PriceResponse memory);
    function global() external view returns (KeeperOracleGlobal memory);
}
