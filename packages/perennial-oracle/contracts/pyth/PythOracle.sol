// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@pythnetwork/pyth-sdk-solidity/AbstractPyth.sol";
import "@equilibria/root/attribute/Instance.sol";
import "@equilibria/root/attribute/Kept.sol";
import "../interfaces/IPythFactory.sol";

/// @title PythOracle
/// @notice Pyth implementation of the IOracle interface.
/// @dev One instance per Pyth price feed should be deployed. Multiple products may use the same
///      PythOracle instance if their payoff functions are based on the same underlying oracle.
///      This implementation only supports non-negative prices.
contract PythOracle is IPythOracle, Instance, Kept {
    /// @dev A Pyth update must come at least this long after a version to be valid
    uint256 constant private MIN_VALID_TIME_AFTER_VERSION = 12 seconds;

    /// @dev A Pyth update must come at most this long after a version to be valid
    uint256 constant private MAX_VALID_TIME_AFTER_VERSION = 15 seconds;

    /// @dev After this amount of time has passed for a version without being committed, the version can be invalidated.
    uint256 constant private GRACE_PERIOD = 1 minutes;

    /// @dev The multiplier for the keeper reward on top of cost
    UFixed18 constant private KEEPER_REWARD_PREMIUM = UFixed18.wrap(1.5e18);

    /// @dev The fixed gas buffer that is added to the keeper reward
    uint256 constant private KEEPER_BUFFER = 80_000;

    /// @dev Pyth contract
    AbstractPyth public immutable pyth;

    /// @dev Pyth price feed id
    bytes32 public id;

    /// @dev List of all requested oracle versions
    uint256[] public versionList;

    /// @dev Index in `versionList` of the next version a keeper should commit
    uint256 public nextVersionIndexToCommit;

    /// @dev Mapping from oracle version to oracle version data
    mapping(uint256 => Fixed6) private _prices;

    /// @dev Mapping from oracle version to when its VAA was published to Pyth
    mapping(uint256 => uint256) private _publishTimes;

    /// @dev The time when the last committed update was published to Pyth
    uint256 private _lastCommittedPublishTime;

    /// @dev The oracle version that was most recently committed
    /// @dev We assume that we cannot commit an oracle version of 0, so `_latestVersion` being 0 means that no version has been committed yet
    uint256 private _latestVersion;

     /// @notice Initializes the immutable contract state
     /// @param pyth_ Pyth contract
    constructor(AbstractPyth pyth_) {
        pyth = pyth_;
    }

    /// @notice Initializes the contract state
    /// @param id_ price ID for Pyth price feed
    /// @param chainlinkFeed_ Chainlink price feed for rewarding keeper in DSU
    /// @param dsu_ Token to pay the keeper reward in
    function initialize(bytes32 id_, AggregatorV3Interface chainlinkFeed_, Token18 dsu_) external initializer(1) {
        __Instance__initialize();
        __UKept__initialize(chainlinkFeed_, dsu_);

        if (!pyth.priceFeedExists(id_)) revert PythOracleInvalidPriceIdError(id_);

        id = id_;
    }

    /// @notice Records a request for a new oracle version
    /// @dev Original sender to optionally use for callbacks
    function request(address) external onlyAuthorized {
        if (versionList.length == 0 || versionList[versionList.length - 1] != block.timestamp) {
            versionList.push(block.timestamp);
        }
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
        if (_latestVersion == 0) return latestVersion;

        return latestVersion = OracleVersion(_latestVersion, _prices[_latestVersion], true);
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
        Fixed6 price = _prices[timestamp];
        return OracleVersion(timestamp, price, !price.isZero());
    }

    /// @notice Returns the next oracle version to commit
    /// @return version The next oracle version to commit
    function nextVersionToCommit() external view returns (uint256 version) {
        if (versionList.length == 0 || nextVersionIndexToCommit >= versionList.length) return 0;
        return versionList[nextVersionIndexToCommit];
    }

    /// @notice Commits the price represented by `updateData` to the next version that needs to be committed
    /// @dev Will revert if there is an earlier versionIndex that could be committed with `updateData`
    /// @param versionIndex The index of the version to commit
    /// @param updateData The update data to commit
    function commitRequested(uint256 versionIndex, bytes calldata updateData)
        public
        payable
        keep(KEEPER_REWARD_PREMIUM, KEEPER_BUFFER, "")
    {
        // This check isn't necessary since the caller would not be able to produce a valid updateData
        // with an update time corresponding to a null version, but reverting with a specific error is
        // clearer.
        if (nextVersionIndexToCommit >= versionList.length) revert PythOracleNoNewVersionToCommitError();
        if (versionIndex < nextVersionIndexToCommit) revert PythOracleVersionIndexTooLowError();

        uint256 versionToCommit = versionList[versionIndex];
        PythStructs.Price memory pythPrice = _validateAndGetPrice(versionToCommit, updateData);

        if (pythPrice.publishTime <= _lastCommittedPublishTime) revert PythOracleNonIncreasingPublishTimes();
        _lastCommittedPublishTime = pythPrice.publishTime;

        // Ensure that the keeper is committing the earliest possible version
        if (versionIndex > nextVersionIndexToCommit) {
            uint256 previousVersion = versionList[versionIndex - 1];
            // We can only skip the previous version if the grace period has expired
            if (block.timestamp <= previousVersion + GRACE_PERIOD) revert PythOracleGracePeriodHasNotExpiredError();

            // If the update is valid for the previous version, we can't skip the previous version
            if (
                pythPrice.publishTime >= previousVersion + MIN_VALID_TIME_AFTER_VERSION &&
                pythPrice.publishTime <= previousVersion + MAX_VALID_TIME_AFTER_VERSION
            ) revert PythOracleUpdateValidForPreviousVersionError();
        }

        _recordPrice(versionToCommit, pythPrice);
        nextVersionIndexToCommit = versionIndex + 1;
        _latestVersion = versionToCommit;
    }

    /// @notice Commits the price to a non-requested version
    /// @dev This commit function may pay out a keeper reward if the commited version is valid
    ///      for the next requested version to commit.
    /// @param oracleVersion The oracle version to commit
    /// @param updateData The update data to commit
    function commit(uint256 oracleVersion, bytes calldata updateData) external payable {
        // Must be before the next requested version to commit, if it exists
        // Otherwise, try to commit it as the next request version to commit
        if (versionList.length > nextVersionIndexToCommit && oracleVersion >= versionList[nextVersionIndexToCommit]) {
            commitRequested(nextVersionIndexToCommit, updateData);
            return;
        }

        PythStructs.Price memory pythPrice = _validateAndGetPrice(oracleVersion, updateData);

        // Oracle version must be more recent than those of the most recently committed version
        if (oracleVersion <= _latestVersion) revert PythOracleVersionTooOldError();

        _recordPrice(oracleVersion, pythPrice);
        _latestVersion = oracleVersion;
    }

    /// @notice Validates that update fees have been paid, and that the VAA represented by `updateData` is within `oracleVersion + MIN_VALID_TIME_AFTER_VERSION` and `oracleVersion + MAX_VALID_TIME_AFTER_VERSION`
    /// @param oracleVersion The oracle version to validate against
    /// @param updateData The update data to validate
    function _validateAndGetPrice(uint256 oracleVersion, bytes calldata updateData) private returns (PythStructs.Price memory price) {
        bytes[] memory updateDataList = new bytes[](1);
        updateDataList[0] = updateData;
        bytes32[] memory idList = new bytes32[](1);
        idList[0] = id;

        return pyth.parsePriceFeedUpdates{value: pyth.getUpdateFee(updateDataList)}(
            updateDataList,
            idList,
            SafeCast.toUint64(oracleVersion + MIN_VALID_TIME_AFTER_VERSION),
            SafeCast.toUint64(oracleVersion + MAX_VALID_TIME_AFTER_VERSION)
        )[0].price;
    }

    /// @notice Records `price` as a Fixed6 at version `oracleVersion`
    /// @param oracleVersion The oracle version to record the price at
    /// @param price The price to record
    function _recordPrice(uint256 oracleVersion, PythStructs.Price memory price) private {
        _prices[oracleVersion] = Fixed6Lib.from(price.price)
            .mul(Fixed6Lib.from(SafeCast.toInt256(10 ** SafeCast.toUint256(price.expo > 0 ? price.expo : -price.expo))));
        _publishTimes[oracleVersion] = price.publishTime;
    }

    /// @notice Pulls funds from the factory to reward the keeper
    /// @param keeperFee The keeper fee to pull
    function _raiseKeeperFee(UFixed18 keeperFee, bytes memory) internal override {
        IPythFactory(address(factory())).claim(UFixed6Lib.from(keeperFee, true));
    }

    /// @dev Only allow authorized callers
    modifier onlyAuthorized {
        if (!IOracleProviderFactory(address(factory())).authorized(msg.sender)) revert OracleProviderUnauthorizedError();
        _;
    }
}
