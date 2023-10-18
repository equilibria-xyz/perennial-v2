// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/attribute/interfaces/IInstance.sol";
import "@equilibria/perennial-v2/contracts/interfaces/IOracleProvider.sol";
import "@equilibria/perennial-v2/contracts/interfaces/IMarket.sol";
import "../Oracle.sol";

interface IPythOracle is IOracleProvider, IInstance {
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

    // sig: 0x9b4e67d3
    error PythOracleVersionOutsideRangeError();
    // sig: 0xcaf4caf3
    error PythOracleInvalidPriceError();
    //sig: 0xb5fe533f
    error PythOracleInvalidCallbackError();

    function initialize(bytes32 id_) external;
    function commit(OracleVersion memory version) external returns (bool);
    function settle(SettlementCallback memory callback) external;
    function next() external view returns (uint256);

    function GRACE_PERIOD() external view returns (uint256);
    function versions(uint256 index) external view returns (uint256);
    function global() external view returns (Global memory);
}
