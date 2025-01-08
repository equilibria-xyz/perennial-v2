// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

// import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import { UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { UFixed18Lib } from "@equilibria/root/number/types/UFixed18.sol";
import { Instance } from "@equilibria/root/attribute/Instance.sol";
import { IGasOracle } from "@equilibria/root/gas/GasOracle.sol";
import { IMarket } from "@perennial/v2-core/contracts/interfaces/IMarket.sol";
import { OracleVersion } from "@perennial/v2-core/contracts/types/OracleVersion.sol";
import { OracleReceipt } from "@perennial/v2-core/contracts/types/OracleReceipt.sol";
import { IKeeperFactory } from "../interfaces/IKeeperFactory.sol";
import { IKeeperOracle } from "../interfaces/IKeeperOracle.sol";
import { OracleParameter } from "../types/OracleParameter.sol";
import { PriceResponse, PriceResponseStorage, PriceResponseLib } from "./types/PriceResponse.sol";
import { KeeperOracleParameter } from "./types/KeeperOracleParameter.sol";
import { IOracle } from "../interfaces/IOracle.sol";

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
    mapping(uint256 => uint256) public requests;

    /// @dev The global state of the oracle
    KeeperOracleGlobal private _global;

    /// @dev Mapping from timestamp to oracle version responses
    mapping(uint256 => PriceResponseStorage) private _responses;

    /// @dev Mapping from version and market to a set of registered accounts for settlement callback
    mapping(uint256 => EnumerableSet.AddressSet) private _localCallbacks;

    /// @notice Constructs the contract
    /// @param timeout_ The timeout for a version to be committed
    constructor(uint256 timeout_) {
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
    function localCallbacks(uint256 version) external view virtual returns (address[] memory) {
        return _localCallbacks[version].values();
    }

    /// @notice Returns the next requested oracle version
    /// @dev Returns 0 if no next version is requested
    /// @return The next requested oracle version
    function next() public view virtual returns (uint256) {
        return requests[_global.latestIndex + 1];
    }

    /// @notice Returns the response for a given oracle version
    /// @param timestamp The timestamp of the oracle version
    /// @return The response for the given oracle version
    function responses(uint256 timestamp) external view virtual returns (PriceResponse memory) {
        return _responses[timestamp].read();
    }

    /// @notice Records a request for a new oracle version
    /// @dev  - If no request has been made this version, a price request will be created
    ///       - If a request has been made this version, no action will be taken
    /// @param account The account to callback to
    function request(IMarket, address account) external virtual onlyOracle {
        uint256 currentTimestamp = current();

        _localCallbacks[currentTimestamp].add(account);
        emit CallbackRequested(SettlementCallback(oracle.market(), account, currentTimestamp));

        if (requests[_global.currentIndex] == currentTimestamp) return; // already requested new price

        requests[++_global.currentIndex] = currentTimestamp;
        emit OracleProviderVersionRequested(currentTimestamp, true);
    }

    /// @notice Returns the latest synced oracle version and the current oracle version
    /// @return The latest synced oracle version
    /// @return The current oracle version collecting new orders
    function status() external view virtual returns (OracleVersion memory, uint256) {
        return (latest(), current());
    }

    /// @notice Returns the latest synced oracle version
    /// @return latestVersion Latest oracle version
    function latest() public view virtual returns (OracleVersion memory latestVersion) {
        (latestVersion, ) = at(_global.latestVersion);
    }

    /// @notice Returns the current oracle version accepting new orders
    /// @return Current oracle version
    function current() public view virtual returns (uint256) {
        return IKeeperFactory(address(factory())).current();
    }

    /// @notice Returns the oracle version at version `version`
    /// @param timestamp The timestamp of which to lookup
    /// @return Oracle version at version `version`
    /// @return Oracle receipt at version `version`
    function at(uint256 timestamp) public view virtual returns (OracleVersion memory, OracleReceipt memory) {
        return (
            _responses[timestamp].read().toOracleVersion(timestamp),
            _responses[timestamp].read().toOracleReceipt(_localCallbacks[timestamp].length())
        );
    }

    /// @notice Commits the price to specified version
    /// @dev Verification of price happens in the oracle's factory
    /// @param version The oracle version to commit
    /// @param receiver The receiver of the settlement fee
    /// @param value The value charged to commit the price in ether
    function commit(OracleVersion memory version, address receiver, uint256 value) external virtual onlyFactory {
        if (version.timestamp == 0) revert KeeperOracleVersionOutsideRangeError();
        PriceResponse memory priceResponse = (version.timestamp == next()) ?
            _commitRequested(version, value) :
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
    /// @param receiver The receiver of the async fee
    function settle(uint256 version, uint256 maxCount, address receiver) external virtual onlyFactory {
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
            market.token().push(receiver, UFixed18Lib.from(priceResponse.asyncFee));
        }
    }

    /// @notice Commits the price to a requested version
    /// @dev This commit function will pay out a keeper fee for providing a valid price or carrying over latest price
    /// @param oracleVersion The oracle version to commit
    /// @param value The value charged to commit the price in ether
    /// @return priceResponse The response to the price request
    function _commitRequested(
        OracleVersion memory oracleVersion,
        uint256 value
    ) private returns (PriceResponse memory priceResponse) {
        IKeeperFactory factory = IKeeperFactory(address(factory()));
        KeeperOracleParameter memory keeperOracleParameter = factory.parameter();
        OracleParameter memory oracleParameter = factory.oracleFactory().parameter();

        if (block.timestamp <= (next() + timeout)) {
            if (!oracleVersion.valid) revert KeeperOracleInvalidPriceError();
            priceResponse.price = oracleVersion.price;
            priceResponse.valid = true;
        } else {
            PriceResponse memory latestPrice = _responses[_global.latestVersion].read();
            priceResponse.price = latestPrice.price;
            priceResponse.valid = false;
        }

        priceResponse.syncFee = UFixed6Lib.from(factory.commitmentGasOracle().cost(value), true);
        priceResponse.asyncFee = UFixed6Lib.from(factory.settlementGasOracle().cost(0), true);
        priceResponse.oracleFee = keeperOracleParameter.oracleFee;
        priceResponse.applyFeeMaximum(
            oracleParameter.maxSettlementFee,
            _localCallbacks[oracleVersion.timestamp].length()
        );

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
