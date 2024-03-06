// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@equilibria/root/attribute/Instance.sol";
import "../interfaces/IKeeperFactory.sol";

/// @title KeeperOracle
/// @notice Generic implementation of the IOracle interface for keeper-based oracles.
/// @dev One instance per price feed should be deployed. Multiple products may use the same
///      KeeperOracle instance if their payoff functions are based on the same underlying oracle.
///      This implementation only supports non-negative prices.
contract KeeperOracle is IKeeperOracle, Instance {
    using EnumerableSet for EnumerableSet.AddressSet;

    /// @dev After this amount of time has passed for a version without being committed, the version can be invalidated.
    uint256 public immutable timeout;

    /// @dev List of all requested oracle versions
    mapping(uint256 => uint256) public versions;

    /// @dev The global state of the oracle
    Global private _global;

    /// @dev Mapping from oracle version to oracle version data
    mapping(uint256 => Fixed6) private _prices;

    /// @dev Mapping from version to a set of registered markets for settlement callback
    mapping(uint256 => EnumerableSet.AddressSet) private _globalCallbacks;

    /// @dev Mapping from version and market to a set of registered accounts for settlement callback
    mapping(uint256 => mapping(IMarket => EnumerableSet.AddressSet)) private _localCallbacks;

    /// @notice Constructs the contract
    /// @param timeout_ The timeout for a version to be committed
    constructor(uint256 timeout_)  {
        timeout = timeout_;
    }

    /// @notice Initializes the contract state
    function initialize() external initializer(1) {
        __Instance__initialize();
    }

    /// @notice Returns the global state of the oracle
    /// @return The global state of the oracle
    function global() external view returns (Global memory) { return _global; }

    /// @notice Returns the global oracle callback set for a version
    /// @param version The version to lookup
    /// @return The global oracle callback set for the version
    function globalCallbacks(uint256 version) external view returns (address[] memory) {
        return _globalCallbacks[version].values();
    }

    /// @notice Returns the local oracle callback set for a version and market
    /// @param version The version to lookup
    /// @param market The market to lookup
    /// @return The local oracle callback set for the version and market
    function localCallbacks(uint256 version, IMarket market) external view returns (address[] memory) {
        return _localCallbacks[version][market].values();
    }

    /// @notice Returns the next requested oracle version
    /// @dev Returns 0 if no next version is requested
    /// @return The next requested oracle version
    function next() public view returns (uint256) {
        return versions[_global.latestIndex + 1];
    }

    /// @notice Records a request for a new oracle version
    /// @param market The market to callback to
    /// @param account The account to callback to
    function request(IMarket market, address account) external onlyAuthorized {
        uint256 currentTimestamp = current();

        _globalCallbacks[currentTimestamp].add(address(market));
        _localCallbacks[currentTimestamp][market].add(account);
        emit CallbackRequested(SettlementCallback(market, account, currentTimestamp));

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
        return IKeeperFactory(address(factory())).current();
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
    function commit(OracleVersion memory version) external onlyFactory returns (bool requested) {
        if (version.timestamp == 0) revert KeeperOracleVersionOutsideRangeError();
        requested = (version.timestamp == next()) ? _commitRequested(version) : _commitUnrequested(version);
        _global.latestVersion = uint64(version.timestamp);

        for (uint256 i; i < _globalCallbacks[version.timestamp].length(); i++)
            _settle(IMarket(_globalCallbacks[version.timestamp].at(i)), address(0));

        emit OracleProviderVersionFulfilled(version);
    }

    /// @notice Performs an asynchronous local settlement callback
    /// @dev Distribution of keeper incentive is consolidated in the oracle's factory
    /// @param market The market to settle
    /// @param version The version to settle
    /// @param maxCount The maximum number of settlement callbacks to perform before exiting
    function settle(IMarket market, uint256 version, uint256 maxCount) external onlyFactory {
        EnumerableSet.AddressSet storage callbacks = _localCallbacks[version][market];

        if (_global.latestVersion < version) revert KeeperOracleVersionOutsideRangeError();
        if (maxCount == 0) revert KeeperOracleInvalidCallbackError();
        if (callbacks.length() == 0) revert KeeperOracleInvalidCallbackError();

        for (uint256 i; i < maxCount && callbacks.length() > 0; i++) {
            address account = callbacks.at(0);
            _settle(market, account);
            callbacks.remove(account);
            emit CallbackFulfilled(SettlementCallback(market, account, version));
        }
    }

    /// @notice Commits the price to a requested version
    /// @dev This commit function will pay out a keeper fee if the committed version is valid
    /// @param version The oracle version to commit
    /// @return Whether the commit was requested
    function _commitRequested(OracleVersion memory version) private returns (bool) {
        if (block.timestamp <= (next() + timeout)) {
            if (!version.valid) revert KeeperOracleInvalidPriceError();
            _prices[version.timestamp] = version.price;
        } else {
            _prices[version.timestamp] = _prices[_global.latestVersion];
        }
        _global.latestIndex++;
        return true;
    }

    /// @notice Commits the price to a non-requested version
    /// @param version The oracle version to commit
    /// @return Whether the commit was requested
    function _commitUnrequested(OracleVersion memory version) private returns (bool) {
        if (!version.valid) revert KeeperOracleInvalidPriceError();
        if (version.timestamp <= _global.latestVersion || (next() != 0 && version.timestamp >= next()))
            revert KeeperOracleVersionOutsideRangeError();
        _prices[version.timestamp] = version.price;
        return false;
    }

    /// @notice Performs a settlement callback for the account on the market
    /// @param market The market to settle
    /// @param account The account to settle
    function _settle(IMarket market, address account) private {
        market.update(account, UFixed6Lib.MAX, UFixed6Lib.MAX, UFixed6Lib.MAX, Fixed6Lib.ZERO, false);
    }

    /// @dev Only allow authorized callers
    modifier onlyAuthorized {
        if (!IOracleProviderFactory(address(factory())).authorized(msg.sender)) revert OracleProviderUnauthorizedError();
        _;
    }
}
