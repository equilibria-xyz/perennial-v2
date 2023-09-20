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

    Global private _global;

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

    // TODO
    function latestVersion() external view returns (uint256) { return _global.latestVersion; }
    function currentIndex() external view returns (uint256) { return _global.currentIndex; }
    function latestIndex() external view returns (uint256) { return _global.latestIndex; }

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

    /// @notice Commits the price to a non-requested version
    /// @dev This commit function may pay out a keeper reward if the committed version is valid
    ///      for the next requested version to commit. A proper `versionIndex` must be supplied in case we are
    ///      ahead of an invalidated requested version and need to verify that the provided version is valid.
    /// @param version The oracle version to commit
    /// @param data The update data to commit
    function commit(uint256 version, bytes calldata data) external payable {
        if (_global.latestIndex < _global.currentIndex && version == versions[_global.latestIndex + 1]) _commitRequested(version, data);
        else _commitUnrequested(version, data);
        _global.latestVersion = uint64(version);
    }

    // TODO
    function _commitRequested(uint256 version, bytes calldata data)
        private
        keep(KEEPER_REWARD_PREMIUM, KEEPER_BUFFER, data, "")
    {
        _prices[version] = (block.timestamp > versions[_global.latestIndex + 1] + GRACE_PERIOD) ?
            Fixed6Lib.ZERO : // TODO: verify that data is empty, or should it be (race condition)?
            _parsePrice(version, data);
        _global.latestIndex++;
    }

    // TODO
    function _commitUnrequested(uint256 version, bytes calldata data) private {
        if (
            version <= _global.latestVersion ||
            (_global.latestIndex != 0 && version <= versions[_global.latestIndex]) ||
            (_global.latestIndex != _global.currentIndex && version >= versions[_global.latestIndex + 1])
        ) revert PythOracleVersionOutsideRangeError();

        _prices[version] = _parsePrice(version, data);
    }

    /// @notice Validates that update fees have been paid, and that the VAA represented by `data` is within `version + MIN_VALID_TIME_AFTER_VERSION` and `version + MAX_VALID_TIME_AFTER_VERSION`
    /// @param version The oracle version to validate against
    /// @param data The update data to validate
    /// @return The parsed price if valid
    function _parsePrice(uint256 version, bytes calldata data) private returns (Fixed6) {
        bytes[] memory datas = new bytes[](1);
        datas[0] = data;
        bytes32[] memory ids = new bytes32[](1);
        ids[0] = id;

        PythStructs.Price memory parsedPrice = pyth.parsePriceFeedUpdates{
            value: IPythStaticFee(address(pyth)).singleUpdateFeeInWei()
        }(
            datas,
            ids,
            SafeCast.toUint64(version + MIN_VALID_TIME_AFTER_VERSION),
            SafeCast.toUint64(version + MAX_VALID_TIME_AFTER_VERSION)
        )[0].price;

        (Fixed6 significand, int256 exponent) = (Fixed6.wrap(parsedPrice.price), parsedPrice.expo + 6);
        Fixed6 base = Fixed6Lib.from(int256(10 ** SignedMath.abs(exponent)));
        return exponent < 0 ? significand.div(base) : significand.mul(base);
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
