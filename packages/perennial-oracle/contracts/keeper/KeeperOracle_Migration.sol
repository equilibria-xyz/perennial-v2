// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import { IMarket } from "@perennial/core/contracts/interfaces/IMarket.sol";
import { OracleVersion } from "@perennial/core/contracts/types/OracleVersion.sol";
import { OracleReceipt } from "@perennial/core/contracts/types/OracleReceipt.sol";
import { PriceResponse } from "./types/PriceResponse.sol";
import { KeeperOracle } from "./KeeperOracle.sol";

/// @title KeeperOracle_Migration
/// @notice Stub implementation to upgrade the prior KeeperOracle to during the v2.3 migration for compatibility.
contract KeeperOracle_Migration is KeeperOracle {
    // sig: 0xd41c17e7
    error NotImplementedError();

    constructor(uint256 timeout_) KeeperOracle(timeout_) { }

    /// @notice Returns an empty response of the correct v2.3 format for forwards compatibility of the previous sub-oracle
    /// @dev Empty responses, as long as they are of the correct format, will be overridden by the Global.latestPrice
    /// @return oracleVersion The empty oracle version
    /// @return oracleReceipt The empty oracle receipt
    function at(uint256 timestamp) public pure override returns (
        OracleVersion memory oracleVersion,
        OracleReceipt memory oracleReceipt
    ) {
        oracleVersion.timestamp = timestamp;
        return (oracleVersion, oracleReceipt);
    }

    /* Do not allow any unintented calls to the previous sub-oracle after migration */

    function localCallbacks(uint256) external pure override returns (address[] memory) { revert NotImplementedError(); }
    function next() public pure override returns (uint256) { revert NotImplementedError(); }
    function responses(uint256) external pure override returns (PriceResponse memory) { revert NotImplementedError(); }
    function request(IMarket, address) external pure override { revert NotImplementedError(); }
    function status() external pure override returns (OracleVersion memory, uint256) { revert NotImplementedError(); }
    function latest() public pure override returns (OracleVersion memory) { revert NotImplementedError(); }
    function current() public pure override returns (uint256) { revert NotImplementedError(); }
    function commit(OracleVersion memory, address, uint256) external pure override { revert NotImplementedError(); }
    function settle(uint256, uint256, address) external pure override { revert NotImplementedError(); }
}
