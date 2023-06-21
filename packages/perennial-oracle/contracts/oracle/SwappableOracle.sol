// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "@equilibria/root/control/unstructured/UOwnable.sol";
import "../IOracleProvider.sol";
import "hardhat/console.sol";

contract SwappableOracle is IOracleProvider, UOwnable {
    error SwappableOracleOutOfOrderCommitError();

    event OracleUpdated(IOracleProvider newProvider);

    struct Oracle {
        IOracleProvider provider;
        uint96 timestamp;
    }

    mapping(uint256 => Oracle) public oracles;
    uint256 public currentOracle;
    uint256 public latestOracle;

    function initialize(IOracleProvider initialProvider) external initializer(1) {
        __UOwnable__initialize();

        _updateCurrent(initialProvider);
        sync();
    }

    function update(IOracleProvider newProvider) external onlyOwner {
        _updateCurrent(newProvider);
        sync();
    }

    function sync() public returns (OracleVersion memory latestVersion, uint256 currentTimestamp) {
        (latestVersion, currentTimestamp) = oracles[currentOracle].provider.sync();
        oracles[currentOracle].timestamp = uint96(currentTimestamp);
        _updateLatest(latestVersion);
        return (latest(), currentTimestamp);
    }

    function latest() public view returns (OracleVersion memory latestVersion) {
        latestVersion = oracles[latestOracle].provider.latest();
        if (latestVersion.timestamp > uint256(oracles[latestOracle].timestamp))
            return at(uint256(oracles[latestOracle].timestamp));
    }

    function current() public view returns (uint256) {
        return oracles[currentOracle].provider.current();
    }

    function at(uint256 timestamp) public view returns (OracleVersion memory) {
        IOracleProvider provider;
        for (uint256 i = currentOracle; i >= 0; i--) {
            if (timestamp > uint256(oracles[i].timestamp)) break;
            provider = oracles[i].provider;
        }

        return provider.at(timestamp);
    }

    function _updateCurrent(IOracleProvider newProvider) private {
        oracles[++currentOracle] = Oracle(newProvider, 0);
        emit OracleUpdated(newProvider);
    }

    function _updateLatest(OracleVersion memory currentOracleLatestVersion) private {
        if (currentOracle == latestOracle) return;

        uint256 latestTimestamp = latestOracle == 0 ? 0 : oracles[latestOracle].provider.latest().timestamp;
        if (uint256(oracles[latestOracle].timestamp) > latestTimestamp) return;
        if (uint256(oracles[latestOracle].timestamp) >= currentOracleLatestVersion.timestamp) return;
        latestOracle++;
    }
}
