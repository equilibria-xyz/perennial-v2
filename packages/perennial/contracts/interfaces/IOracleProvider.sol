// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { OracleReceipt } from "../types/OracleReceipt.sol";
import { OracleVersion } from "../types/OracleVersion.sol";
import { IMarket } from "./IMarket.sol";

/// @dev OracleVersion Invariants
///       - Version are requested at a timestamp, the current timestamp is determined by the oracle
///         - The current timestamp may not be equal to block.timestamp, for example when batching timestamps
///       - Versions are allowed to "fail" and will be marked as .valid = false
///         - Invalid versions will always include the latest valid price as its price field
///       - Versions must be committed in order, i.e. all requested versions prior to latestVersion must be available
///       - Non-requested versions may be committed, but will not receive a settlement fee
///         - This is useful for immediately liquidating an account with a valid off-chain price in between orders
///         - Satisfying the above constraints, only versions more recent than the latest version may be committed
///       - Current must always be greater than Latest, never equal
interface IOracleProvider {
    // sig: 0x652fafab
    error OracleProviderUnauthorizedError();

    event OracleProviderVersionRequested(uint256 indexed version, bool newPrice);
    event OracleProviderVersionFulfilled(OracleVersion version);

    function request(IMarket market, address account) external;
    function status() external view returns (OracleVersion memory, uint256);
    function latest() external view returns (OracleVersion memory);
    function current() external view returns (uint256);
    function at(uint256 timestamp) external view returns (OracleVersion memory, OracleReceipt memory);
}