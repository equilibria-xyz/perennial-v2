// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "@equilibria/root/attribute/Instance.sol";
import "@equilibria/perennial-v2/contracts/interfaces/IOracleProviderFactory.sol";
import "./interfaces/IOracle.sol";

/// @title Oracle
/// @notice The top-level oracle contract that implements an oracle provider interface.
/// @dev Manages swapping between different underlying oracle provider interfaces over time.
contract Oracle is IOracle, Instance {
    /// @notice A historical mapping of underlying oracle providers
    mapping(uint256 => Epoch) public oracles;

    /// @notice The global state of the oracle
    Global public global;

    /// @notice Initializes the contract state
    /// @param initialProvider The initial oracle provider
    function initialize(IOracleProvider initialProvider) external initializer(1) {
        __Instance__initialize();
        _updateCurrent(initialProvider);
        _updateLatest(initialProvider.latest());
    }

    /// @notice Updates the current oracle provider
    /// @param newProvider The new oracle provider
    function update(IOracleProvider newProvider) external onlyOwner {
        _updateCurrent(newProvider);
        _updateLatest(newProvider.latest());
    }

    /// @notice Requests a new version at the current timestamp
    /// @param account Original sender to optionally use for callbacks
    function request(address account) external onlyAuthorized {
        (OracleVersion memory latestVersion, uint256 currentTimestamp) = oracles[global.current].provider.status();

        oracles[global.current].provider.request(account);
        oracles[global.current].timestamp = uint96(currentTimestamp);
        _updateLatest(latestVersion);
    }

    /// @notice Returns the latest committed version as well as the current timestamp
    /// @return latestVersion The latest committed version
    /// @return currentTimestamp The current timestamp
    function status() external view returns (OracleVersion memory latestVersion, uint256 currentTimestamp) {
        (latestVersion, currentTimestamp) = oracles[global.current].provider.status();
        latestVersion = _handleLatest(latestVersion);
    }

    /// @notice Returns the latest committed version
    function latest() public view returns (OracleVersion memory) {
        return _handleLatest(oracles[global.current].provider.latest());
    }

    /// @notice Returns the current value
    function current() public view returns (uint256) {
        return oracles[global.current].provider.current();
    }

    /// @notice Returns the oracle version at a given timestamp
    /// @param timestamp The timestamp to query
    /// @return atVersion The oracle version at the given timestamp
    function at(uint256 timestamp) public view returns (OracleVersion memory atVersion) {
        if (timestamp == 0) return atVersion;
        IOracleProvider provider = oracles[global.current].provider;
        for (uint256 i = global.current - 1; i > 0; i--) {
            if (timestamp > uint256(oracles[i].timestamp)) break;
            provider = oracles[i].provider;
        }
        return provider.at(timestamp);
    }

    /// @notice Handles update the oracle to the new provider
    /// @param newProvider The new oracle provider
    function _updateCurrent(IOracleProvider newProvider) private {
        if (global.current != global.latest) revert OracleOutOfSyncError();
        oracles[uint256(++global.current)] = Epoch(newProvider, uint96(newProvider.current()));
        emit OracleUpdated(newProvider);
    }

    /// @notice Handles updating the latest oracle to the current if it is ready
    /// @param currentOracleLatestVersion The latest version from the current oracle
    function _updateLatest(OracleVersion memory currentOracleLatestVersion) private {
        if (_latestStale(currentOracleLatestVersion)) global.latest = global.current;
    }

    /// @notice Handles overriding the latest version
    /// @dev Applicable if we haven't yet switched over to the current oracle from the latest oracle
    /// @param currentOracleLatestVersion The latest version from the current oracle
    /// @return latestVersion The latest version
    function _handleLatest(
        OracleVersion memory currentOracleLatestVersion
    ) private view returns (OracleVersion memory latestVersion) {
        if (global.current == global.latest) return currentOracleLatestVersion;

        bool isLatestStale = _latestStale(currentOracleLatestVersion);
        latestVersion = isLatestStale ? currentOracleLatestVersion : oracles[global.latest].provider.latest();

        uint256 latestOracleTimestamp =
            uint256(isLatestStale ? oracles[global.current].timestamp : oracles[global.latest].timestamp);
        if (!isLatestStale && latestVersion.timestamp > latestOracleTimestamp)
            return at(latestOracleTimestamp);
    }

    /// @notice Returns whether the latest oracle is ready to be updated
    /// @param currentOracleLatestVersion The latest version from the current oracle
    /// @return Whether the latest oracle is ready to be updated
    function _latestStale(OracleVersion memory currentOracleLatestVersion) private view returns (bool) {
        if (global.current == global.latest) return false;

        uint256 latestTimestamp = global.latest == 0 ? 0 : oracles[global.latest].provider.latest().timestamp;
        if (uint256(oracles[global.latest].timestamp) > latestTimestamp) return false;
        if (uint256(oracles[global.latest].timestamp) >= currentOracleLatestVersion.timestamp) return false;

        return true;
    }

    /// @dev Only if the caller is authorized by the factory
    modifier onlyAuthorized {
        if (!IOracleProviderFactory(address(factory())).authorized(msg.sender))
            revert OracleProviderUnauthorizedError();
        _;
    }
}
