// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@pythnetwork/pyth-sdk-solidity/AbstractPyth.sol";
import "@equilibria/root/attribute/Instance.sol";
import "@equilibria/root/attribute/Kept/Kept.sol";
import "../interfaces/IPythFactory.sol";

/// @title PythOracle
/// @notice Pyth implementation of the IOracle interface.
/// @dev One instance per Pyth price feed should be deployed. Multiple products may use the same
///      PythOracle instance if their payoff functions are based on the same underlying oracle.
///      This implementation only supports non-negative prices.
contract PythOracle is IPythOracle, Instance {
    /// @dev After this amount of time has passed for a version without being committed, the version can be invalidated.
    uint256 constant public GRACE_PERIOD = 1 minutes;

    /// @dev Pyth price feed id
    bytes32 public id;

    /// @dev List of all requested oracle versions
    mapping(uint256 => uint256) public versions;

    Global private _global;

    /// @dev Mapping from oracle version to oracle version data
    mapping(uint256 => Fixed6) private _prices;

    /// @notice Initializes the contract state
    /// @param id_ price ID for Pyth price feed
    function initialize(bytes32 id_) external initializer(1) {
        __Instance__initialize();
        id = id_;
    }

    /// @notice Returns the global state of the oracle
    /// @return The global state of the oracle
    function global() external view returns (Global memory) { return _global; }

    /// @notice Returns the next requested oracle version
    /// @dev Returns 0 if no next version is requested
    /// @return The next requested oracle version
    function next() public view returns (uint256) {
        return versions[_global.latestIndex + 1];
    }

    /// @notice Records a request for a new oracle version
    /// @dev Original sender to optionally use for callbacks
    function request(address) external onlyAuthorized {
        uint256 currentTimestamp = current();
        if (versions[_global.currentIndex] == currentTimestamp) return;

        versions[++_global.currentIndex] = currentTimestamp;
        emit OracleProviderVersionRequested(currentTimestamp);
    }

    /// @notice Returns the latest synced oracle version and the current oracle version
    /// @return The latest synced oracle version
    /// @return The current oracle version collecting new orders
    function status() external view returns (OracleVersion memory, uint256) {
        return (latest(), current());
    }

    /// @notice Returns the latest synced oracle version
    /// @return Latest oracle version
    function latest() public view returns (OracleVersion memory) {
        return at(_global.latestVersion);
    }

    /// @notice Returns the current oracle version accepting new orders
    /// @return Current oracle version
    function current() public view returns (uint256) {
        return IPythFactory(address(factory())).current();
    }

    /// @notice Returns the oracle version at version `version`
    /// @param timestamp The timestamp of which to lookup
    /// @return oracleVersion Oracle version at version `version`
    function at(uint256 timestamp) public view returns (OracleVersion memory oracleVersion) {
        (oracleVersion.timestamp, oracleVersion.price) = (timestamp, _prices[timestamp]);
        oracleVersion.valid = !oracleVersion.price.isZero();
    }

    /// @notice Commits the price to specified version
    /// @dev Verification of price happens in the oracle's factory
    /// @param version The oracle version to commit
    /// @return requested Whether the commit was requested
    function commit(OracleVersion memory version) external returns (bool requested) {
        if (msg.sender != address(factory())) revert OracleProviderUnauthorizedError(); // TODO: make modifier in root

        if (version.timestamp == 0) revert PythOracleVersionOutsideRangeError();
        requested = (version.timestamp == next()) ? _commitRequested(version) : _commitUnrequested(version);
        _global.latestVersion = uint64(version.timestamp);
        emit OracleProviderVersionFulfilled(version);
    }

    /// @notice Commits the price to a requested version
    /// @dev This commit function will pay out a keeper reward if the committed version is valid
    /// @param version The oracle version to commit
    /// @return Whether the commit was requested
    function _commitRequested(OracleVersion memory version) private returns (bool) {
        if (block.timestamp <= (next() + GRACE_PERIOD)) {
            if (!version.valid) revert PythOracleInvalidPriceError();
            _prices[version.timestamp] = version.price;
        }
        _global.latestIndex++;
        return true;
    }

    /// @notice Commits the price to a non-requested version
    /// @param version The oracle version to commit
    /// @return Whether the commit was requested
    function _commitUnrequested(OracleVersion memory version) private returns (bool) {
        if (!version.valid) revert PythOracleInvalidPriceError();
        if (version.timestamp <= _global.latestVersion || (next() != 0 && version.timestamp >= next()))
            revert PythOracleVersionOutsideRangeError();
        _prices[version.timestamp] = version.price;
        return false;
    }

    /// @dev Only allow authorized callers
    modifier onlyAuthorized {
        if (!IOracleProviderFactory(address(factory())).authorized(msg.sender)) revert OracleProviderUnauthorizedError();
        _;
    }
}
