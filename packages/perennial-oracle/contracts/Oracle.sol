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
        (OracleVersion memory latestVersion, uint256 currentTimestamp) =
            oracles[uint256(global.current)].provider.status();

        oracles[uint256(global.current)].provider.request();
        oracles[uint256(global.current)].timestamp = uint96(currentTimestamp);
        _updateLatest(latestVersion);
    }

    function status() external view returns (OracleVersion memory, uint256) {
        return (latest(), current());
    }

    function latest() public view returns (OracleVersion memory latestVersion) {
        OracleVersion memory currentOracleLatestVersion = oracles[uint256(global.current)].provider.latest();

        uint256 latestOracle = _latestStale(currentOracleLatestVersion) ? uint256(global.current) : uint256(global.latest);
        latestVersion = oracles[latestOracle].provider.latest();

        if (
            latestOracle != uint256(global.current) &&
            latestVersion.timestamp > uint256(oracles[latestOracle].timestamp)
        ) return at(uint256(oracles[latestOracle].timestamp));
    }

    function current() public view returns (uint256) {
        return oracles[uint256(global.current)].provider.current();
    }

    function at(uint256 timestamp) public view returns (OracleVersion memory atVersion) {
        if (timestamp == 0) return atVersion;

        IOracleProvider provider = oracles[uint256(global.current)].provider;
        for (uint256 i = uint256(global.current) - 1; i > 0; i--) {
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
        uint256 latestTimestamp = uint256(global.latest) == 0 ? 0 : oracles[uint256(global.latest)].provider.latest().timestamp;
        if (uint256(oracles[uint256(global.latest)].timestamp) > latestTimestamp) return false;
        if (uint256(oracles[uint256(global.latest)].timestamp) >= currentOracleLatestVersion.timestamp) return false;
        return true;
    }

    modifier onlyAuthorized {
        if (!IOracleProviderFactory(address(factory())).authorized(msg.sender))
            revert OracleProviderUnauthorizedError();
        _;
    }
}
