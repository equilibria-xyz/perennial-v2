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
contract PythOracle is IPythOracle, Instance, Kept {
    /// @dev A Pyth update must come at least this long after a version to be valid
    uint256 constant public MIN_VALID_TIME_AFTER_VERSION = 4 seconds;

    /// @dev A Pyth update must come at most this long after a version to be valid
    uint256 constant public MAX_VALID_TIME_AFTER_VERSION = 10 seconds;

    /// @dev After this amount of time has passed for a version without being committed, the version can be invalidated.
    uint256 constant public GRACE_PERIOD = 1 minutes;

    /// @dev The multiplier for the keeper reward on top of cost
    UFixed18 constant public KEEPER_REWARD_PREMIUM = UFixed18.wrap(3e18);

    /// @dev The fixed gas buffer that is added to the keeper reward
    uint256 constant public KEEPER_BUFFER = 1_000_000;

    /// @dev Pyth contract
    AbstractPyth public immutable pyth;

    /// @dev Pyth price feed id
    bytes32 public id;

    /// @dev List of all requested oracle versions
    mapping(uint256 => uint256) public versions;

    /// TODO
    uint256 public latestVersion;

    /// @dev Index in `versions` of the next version a keeper should commit
    uint256 public currentIndex;

    /// @dev Index in `versions` of the next version a keeper should commit
    uint256 public latestIndex;

    /// @dev Mapping from oracle version to oracle version data
    mapping(uint256 => Fixed6) private _prices;

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
        __Kept__initialize(chainlinkFeed_, dsu_);

        if (!pyth.priceFeedExists(id_)) revert PythOracleInvalidPriceIdError(id_);

        id = id_;
    }

    /// @notice Records a request for a new oracle version
    /// @dev Original sender to optionally use for callbacks
    function request(address) external onlyAuthorized {
        uint256 currentTimestamp = current();
        if (currentIndex == 0 || versions[currentIndex] != currentTimestamp) {
            versions[currentIndex++] = currentTimestamp;
            emit OracleProviderVersionRequested(currentTimestamp);
        }
    }

    /// @notice Returns the latest synced oracle version and the current oracle version
    /// @return The latest synced oracle version
    /// @return The current oracle version collecting new orders
    function status() external view returns (OracleVersion memory, uint256) {
        return (latest(), current());
    }

    /// @notice Returns the latest synced oracle version
    /// @return latestOracleVersion Latest oracle version
    function latest() public view returns (OracleVersion memory latestOracleVersion) {
        if (latestVersion == 0) return latestOracleVersion;
        latestOracleVersion = OracleVersion(latestVersion, _prices[latestVersion], true);
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

    /// @notice Commits the price to a non-requested version
    /// @dev This commit function may pay out a keeper reward if the committed version is valid
    ///      for the next requested version to commit. A proper `versionIndex` must be supplied in case we are
    ///      ahead of an invalidated requested version and need to verify that the provided version is valid.
    /// @param version The oracle version to commit
    /// @param updateData The update data to commit
    function commit(uint256 version, bytes calldata updateData) external payable {
        Fixed6 price = _validateAndGetPrice(version, updateData);

        // requested
        if (latestIndex < currentIndex && version == versions[latestIndex + 1]) {
            // If past grace period, invalidate the version
            _prices[version] = (block.timestamp > versions[latestIndex] + GRACE_PERIOD) ?
                Fixed6Lib.ZERO :
                _prices[version] = price;
            latestIndex++;

        // unrequested
        } else {
            // Oracle version must be between the latest and next indexes
            uint256 minVersion = Math.max(latestIndex == 0 ? 0 : versions[latestIndex], latestVersion);
            uint256 maxVersion = latestIndex == currentIndex ? type(uint256).max : versions[latestIndex + 1];
            if (version <= minVersion || version >= maxVersion) revert PythOracleVersionOutsideRangeError();

            _prices[version] = price;
        }

        latestVersion = version;
    }

    /// @notice Validates that update fees have been paid, and that the VAA represented by `updateData` is within `oracleVersion + MIN_VALID_TIME_AFTER_VERSION` and `oracleVersion + MAX_VALID_TIME_AFTER_VERSION`
    /// @param oracleVersion The oracle version to validate against
    /// @param updateData The update data to validate
    function _validateAndGetPrice(uint256 oracleVersion, bytes calldata updateData) private returns (Fixed6 price) {
        bytes[] memory updateDataList = new bytes[](1);
        updateDataList[0] = updateData;
        bytes32[] memory idList = new bytes32[](1);
        idList[0] = id;

        // Limit the value passed in the single update fee * number of updates to prevent packing the update data
        // with extra updates to increase the keeper fee. When Pyth updates their fee calculations
        // we will need to modify this to account for the new fee logic.
        PythStructs.Price memory pythPrice = pyth.parsePriceFeedUpdates{
            value: IPythStaticFee(address(pyth)).singleUpdateFeeInWei() * idList.length
        }(
            updateDataList,
            idList,
            SafeCast.toUint64(oracleVersion + MIN_VALID_TIME_AFTER_VERSION),
            SafeCast.toUint64(oracleVersion + MAX_VALID_TIME_AFTER_VERSION)
        )[0].price;

        int256 expo6Decimal = 6 + pythPrice.expo;
        return (expo6Decimal < 0) ?
            Fixed6.wrap(pythPrice.price).div(Fixed6Lib.from(UFixed6Lib.from(10 ** uint256(-expo6Decimal)))) :
            Fixed6.wrap(pythPrice.price).mul(Fixed6Lib.from(UFixed6Lib.from(10 ** uint256(expo6Decimal))));
    }

    /// @notice Pulls funds from the factory to reward the keeper
    /// @param keeperFee The keeper fee to pull
    function _raiseKeeperFee(UFixed18 keeperFee, bytes memory) internal virtual override {
        IPythFactory(address(factory())).claim(UFixed6Lib.from(keeperFee, true));
    }

    /// @dev Only allow authorized callers
    modifier onlyAuthorized {
        if (!IOracleProviderFactory(address(factory())).authorized(msg.sender)) revert OracleProviderUnauthorizedError();
        _;
    }
}
