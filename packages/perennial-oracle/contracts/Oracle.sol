// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "@equilibria/root-v2/contracts/Instance.sol";
import "./interfaces/IOracle.sol";
import "./interfaces/IOracleProviderFactory.sol";

contract Oracle is IOracle, Instance {
    mapping(uint256 => Checkpoint) public oracles;
    Global public global;

    function initialize(IOracleProvider initialProvider) external initializer(1) {
        __Instance__initialize();
        _updateCurrent(initialProvider);
        _updateLatest(initialProvider.latest());
    }

    function update(IOracleProvider newProvider) external onlyOwner {
        _updateCurrent(newProvider);
        _updateLatest(newProvider.latest());
    }

    function request() external onlyAuthorized {
        (OracleVersion memory latestVersion, uint256 currentTimestamp) = oracles[global.current].provider.status();

        oracles[global.current].provider.request();
        oracles[global.current].timestamp = uint96(currentTimestamp);
        _updateLatest(latestVersion);
    }

    function status() external view returns (OracleVersion memory latestVersion, uint256 currentTimestamp) {
        (latestVersion, currentTimestamp) = oracles[global.current].provider.status();
        _handleLatest(latestVersion);
    }

    function latest() public view returns (OracleVersion memory latestVersion) {
        latestVersion = oracles[global.current].provider.latest();
        _handleLatest(latestVersion);
    }

    function _handleLatest(OracleVersion memory latestVersion) private view {
        if (global.current == global.latest) return;

        bool isLatestStale = _latestStale(latestVersion);
        if (!isLatestStale) latestVersion = oracles[global.latest].provider.latest();

        uint256 latestOracleTimestamp =
            uint256(isLatestStale ? oracles[global.current].timestamp : oracles[global.latest].timestamp);

        if (!isLatestStale && latestVersion.timestamp > latestOracleTimestamp)
            latestVersion = at(latestOracleTimestamp);
    }

    function current() public view returns (uint256) {
        return oracles[global.current].provider.current();
    }

    function at(uint256 timestamp) public view returns (OracleVersion memory atVersion) {
        if (timestamp == 0) return atVersion;

        IOracleProvider provider = oracles[global.current].provider;
        for (uint256 i = global.current - 1; i > 0; i--) {
            if (timestamp > uint256(oracles[i].timestamp)) break;
            provider = oracles[i].provider;
        }
        return provider.at(timestamp);
    }

    function _updateCurrent(IOracleProvider newProvider) private {
        if (global.current != global.latest) revert OracleOutOfSyncError();
        oracles[uint256(++global.current)] = Checkpoint(newProvider, uint96(newProvider.current()));
        emit OracleUpdated(newProvider);
    }

    function _updateLatest(OracleVersion memory currentOracleLatestVersion) private {
        if (_latestStale(currentOracleLatestVersion)) global.latest = global.current;
    }

    function _latestStale(OracleVersion memory currentOracleLatestVersion) private view returns (bool) {
        if (global.current == global.latest) return false;

        uint256 latestTimestamp = global.latest == 0 ? 0 : oracles[global.latest].provider.latest().timestamp;
        if (uint256(oracles[global.latest].timestamp) > latestTimestamp) return false;
        if (uint256(oracles[global.latest].timestamp) >= currentOracleLatestVersion.timestamp) return false;

        return true;
    }

    modifier onlyAuthorized {
        if (!IOracleProviderFactory(address(factory())).authorized(msg.sender))
            revert OracleProviderUnauthorizedError();
        _;
    }
}
