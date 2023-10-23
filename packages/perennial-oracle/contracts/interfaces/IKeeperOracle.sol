// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/attribute/interfaces/IInstance.sol";
import "@equilibria/perennial-v2/contracts/interfaces/IOracleProvider.sol";
import "@equilibria/perennial-v2/contracts/interfaces/IMarket.sol";
import "../Oracle.sol";

interface IKeeperOracle is IOracleProvider, IInstance {
    event CallbackRequested(SettlementCallback indexed callback);
    event CallbackFulfilled(SettlementCallback indexed callback);

    struct SettlementCallback {
        /// @dev The market to settle
        IMarket market;

        /// @dev The account to settle
        address account;

        /// @dev The version to settle for
        uint256 version;
    }

    struct Global {
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

    function initialize() external;
    function commit(OracleVersion memory version) external returns (bool);
    function settle(IMarket market, uint256 version, uint256 maxCount) external;
    function next() external view returns (uint256);
    function globalCallbacks(uint256 version) external view returns (address[] memory);
    function localCallbacks(uint256 version, IMarket market) external view returns (address[] memory);

    function timeout() external view returns (uint256);
    function versions(uint256 index) external view returns (uint256);
    function global() external view returns (Global memory);
}
