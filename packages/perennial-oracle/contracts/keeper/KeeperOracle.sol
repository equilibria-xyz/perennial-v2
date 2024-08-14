// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@equilibria/root/attribute/Instance.sol";
import "../interfaces/IKeeperFactory.sol";
import { PriceResponse, PriceResponseStorage, PriceResponseLib } from "./types/PriceResponse.sol";
import { PriceRequest, PriceRequestStorage } from "./types/PriceRequest.sol";

/// @title KeeperOracle
/// @notice Generic implementation of the IOracle interface for keeper-based oracles.
/// @dev One instance per price feed should be deployed. Multiple products may use the same
///      KeeperOracle instance if their payoff functions are based on the same underlying oracle.
///      This implementation only supports non-negative prices.
contract KeeperOracle is IKeeperOracle, Instance {
    using EnumerableSet for EnumerableSet.AddressSet;

    /// @dev The oracle provider authorized to call this sub oracle
    IOracle public oracle;

    /// @dev After this amount of time has passed for a version without being committed, the version can be invalidated.
    uint256 public immutable timeout;

    /// @dev List of all requested new price oracle versions by index
    mapping(uint256 => PriceRequestStorage) public _requests;

    /// @dev The global state of the oracle
    KeeperOracleGlobal private _global;

    /// @dev Mapping from timestamp to oracle version responses
    mapping(uint256 => PriceResponseStorage) private _responses;

    /// @dev Mapping from version and market to a set of registered accounts for settlement callback
    mapping(uint256 => EnumerableSet.AddressSet) private _localCallbacks;

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
    function global() external view returns (KeeperOracleGlobal memory) { return _global; }

    /// @notice Updates the registered oracle provider
    /// @dev The oracle provider is the only authorized caller
    /// @param newOracle The new oracle provider
    function register(IOracle newOracle) external onlyOwner {
        oracle = newOracle;
        emit OracleUpdated(newOracle);
    }

    /// @notice Returns the local oracle callback set for a version and market
    /// @param version The version to lookup
    /// @return The local oracle callback set for the version and market
    function localCallbacks(uint256 version) external view returns (address[] memory) {
        return _localCallbacks[version].values();
    }

    /// @notice Returns the next requested oracle version
    /// @dev Returns 0 if no next version is requested
    /// @return The next requested oracle version
    function next() public view returns (uint256) {
        return _requests[_global.latestIndex + 1].read().timestamp;
    }

    /// @notice Returns the requested oracle version at index `index`
    /// @param index The index of the requested oracle version
    /// @return The requested oracle version at index `index`
    function requests(uint256 index) external view returns (PriceRequest memory) {
        return _requests[index].read();
    }

    /// @notice Returns the response for a given oracle version
    /// @param timestamp The timestamp of the oracle version
    /// @return The response for the given oracle version
    function responses(uint256 timestamp) external view returns (PriceResponse memory) {
        return _responses[timestamp].read();
    }

    /// @notice Records a request for a new oracle version
    /// @dev  - If no request has been made this version, a price request will be created
    ///       - If a request has been made this version, no action will be taken
    /// @param account The account to callback to
    function request(IMarket, address account) external onlyOracle {
        KeeperOracleParameter memory keeperOracleParameter = IKeeperFactory(address(factory())).parameter();
        uint256 currentTimestamp = current();

        _localCallbacks[currentTimestamp].add(account);
        emit CallbackRequested(SettlementCallback(oracle.market(), account, currentTimestamp));

        PriceRequest memory currentRequest = _requests[_global.currentIndex].read();

        if (currentRequest.timestamp == currentTimestamp) return; // already requested new price

        _requests[++_global.currentIndex].store(
            PriceRequest(
                currentTimestamp,
                keeperOracleParameter.syncFee,
                keeperOracleParameter.asyncFee,
                keeperOracleParameter.oracleFee
            )
        );
        emit OracleProviderVersionRequested(currentTimestamp, true);
    }

    /// @notice Returns the latest synced oracle version and the current oracle version
    /// @return The latest synced oracle version
    /// @return The current oracle version collecting new orders
    function status() external view returns (OracleVersion memory, uint256) {
        return (latest(), current());
    }

    /// @notice Returns the latest synced oracle version
    /// @return latestVersion Latest oracle version
    function latest() public view returns (OracleVersion memory latestVersion) {
        (latestVersion, ) = at(_global.latestVersion);
    }

    /// @notice Returns the current oracle version accepting new orders
    /// @return Current oracle version
    function current() public view returns (uint256) {
        return IKeeperFactory(address(factory())).current();
    }

    /// @notice Returns the oracle version at version `version`
    /// @param timestamp The timestamp of which to lookup
    /// @return Oracle version at version `version`
    /// @return Oracle receipt at version `version`
    function at(uint256 timestamp) public view returns (OracleVersion memory, OracleReceipt memory) {
        return (
            _responses[timestamp].read().toOracleVersion(timestamp),
            _responses[timestamp].read().toOracleReceipt(_localCallbacks[timestamp].length())
        );
    }

    /// @notice Commits the price to specified version
    /// @dev Verification of price happens in the oracle's factory
    /// @param version The oracle version to commit
    /// @param receiver The receiver of the settlement fee
    function commit(OracleVersion memory version, address receiver) external onlyFactory {
        if (version.timestamp == 0) revert KeeperOracleVersionOutsideRangeError();
        PriceResponse memory priceResponse = (version.timestamp == next()) ?
            _commitRequested(version) :
            _commitUnrequested(version);
        _global.latestVersion = uint64(version.timestamp);

        emit OracleProviderVersionFulfilled(version);

        IMarket market = oracle.market();
        market.settle(address(0));
        oracle.claimFee(priceResponse.toOracleReceipt(_localCallbacks[version.timestamp].length()).settlementFee);
        market.token().push(receiver, UFixed18Lib.from(priceResponse.syncFee));
    }

    /// @notice Performs an asynchronous local settlement callback
    /// @dev Distribution of keeper incentive is consolidated in the oracle's factory
    /// @param version The version to settle
    /// @param maxCount The maximum number of settlement callbacks to perform before exiting
    function settle(uint256 version, uint256 maxCount) external onlyFactory {
        EnumerableSet.AddressSet storage callbacks = _localCallbacks[version];

        if (_global.latestVersion < version) revert KeeperOracleVersionOutsideRangeError();
        if (maxCount == 0) revert KeeperOracleInvalidCallbackError();
        if (callbacks.length() == 0) revert KeeperOracleInvalidCallbackError();

        IMarket market = oracle.market();

        for (uint256 i; i < maxCount && callbacks.length() > 0; i++) {
            address account = callbacks.at(0);
            market.settle(account);
            callbacks.remove(account);
            emit CallbackFulfilled(SettlementCallback(market, account, version));

            // full settlement fee already cleamed in commit
            PriceResponse memory priceResponse = _responses[version].read();
            market.token().push(msg.sender, UFixed18Lib.from(priceResponse.asyncFee));
        }
    }

    /// @notice Commits the price to a requested version
    /// @dev This commit function will pay out a keeper fee for providing a valid price or carrying over latest price
    /// @param oracleVersion The oracle version to commit
    /// @return priceResponse The response to the price request
    function _commitRequested(OracleVersion memory oracleVersion) private returns (PriceResponse memory priceResponse) {
        PriceRequest memory priceRequest = _requests[_global.latestIndex + 1].read();

        if (block.timestamp <= (next() + timeout)) {
            if (!oracleVersion.valid) revert KeeperOracleInvalidPriceError();
            priceResponse = priceRequest.toPriceResponse(oracleVersion);
        } else {
            PriceResponse memory latestPrice = _responses[_global.latestVersion].read();
            priceResponse = priceRequest.toPriceResponseInvalid(latestPrice);
        }

        _responses[oracleVersion.timestamp].store(priceResponse);
        _global.latestIndex++;
    }

    /// @notice Commits the price to a non-requested version
    /// @param oracleVersion The oracle version to commit
    /// @return priceResponse The response to the price request
    function _commitUnrequested(OracleVersion memory oracleVersion) private returns (PriceResponse memory priceResponse) {
        if (!oracleVersion.valid) revert KeeperOracleInvalidPriceError();
        if (oracleVersion.timestamp <= _global.latestVersion || (next() != 0 && oracleVersion.timestamp >= next()))
            revert KeeperOracleVersionOutsideRangeError();

        priceResponse = PriceResponseLib.fromUnrequested(oracleVersion);

        _responses[oracleVersion.timestamp].store(priceResponse);
    }

    /// @dev Only allow authorized oracle provider to call
    modifier onlyOracle {
        if (msg.sender != address(oracle)) revert KeeperOracleNotOracleError();
        _;
    }
}
