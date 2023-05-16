// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@pythnetwork/pyth-sdk-solidity/AbstractPyth.sol";
import "../IOracleProvider.sol";

/**
 * @title PythOracle
 * @notice Pyth implementation of the IOracle interface.
 * @dev One instance per Pyth price feed should be deployed. Multiple products may use the same
 *      PythOracle instance if their payoff functions are based on the same underlying oracle.
 *      This implementation only supports non-negative prices.
 */
contract PythOracle is IOracleProvider {
    /// @dev A Pyth update must come at least this long after a version to be valid
    uint256 constant private MIN_VALID_TIME_AFTER_VERSION = 12 seconds;

    /// @dev A Pyth update must come at most this long after a version to be valid
    uint256 constant private MAX_VALID_TIME_AFTER_VERSION = 15 seconds;

    /// @dev Pyth contract
    AbstractPyth public immutable pyth;

    /// @dev Pyth price feed id
    bytes32 public immutable priceId;

    /// @dev Mapping from oracle version to oracle version data
    mapping (uint256 => OracleVersion) private _versions;

    /// @dev Last committed oracle version
    OracleVersion private lastCommittedVersion;

    /// @dev List of all requested oracle versions
    uint256[] private _versionList;

    /// @dev Index in `_versionList` of the next version a keeper should commit
    uint256 private _nextVersionIndexToCommit;

    error PythOracleInvalidPriceId(bytes32 priceId);
    error PythOracleNoNewVersionToCommit();

    constructor(AbstractPyth pyth_, bytes32 priceId_) {
        if (!pyth_.priceFeedExists(priceId_)) revert PythOracleInvalidPriceId(priceId_);

        pyth = pyth_;
        priceId = priceId_;
    }

    /**
     * @notice Checks for a new price and updates the internal phase annotation state accordingly
     * @return latestVersion The latest synced oracle version
     * @return currentVersion The current oracle version collecting new orders
     */
    function sync() external returns (OracleVersion memory latestVersion, uint256 currentVersion) {
        if (_versionList.length == 0 || _versionList[_versionList.length - 1] != block.timestamp) {
            _versionList.push(block.timestamp);
        }

        // TODO: Figure out what to do in the core protocol if no version has ever been committed.
        latestVersion = lastCommittedVersion;
        currentVersion = latestVersion.version == 0 ? 0 : block.timestamp;
    }

    /**
     * @notice Returns the latest synced oracle version
     * @return Latest oracle version
     */
    function latest() public view returns (OracleVersion memory) {
        return lastCommittedVersion;
    }

    /**
     * @notice Returns the current oracle version accepting new orders
     * @return Current oracle version
     */
    function current() public view returns (uint256) {
        return block.timestamp;
    }

    /**
     * @notice Returns the current oracle version
     * @param version The version of which to lookup
     * @return oracleVersion Oracle version at version `version`
     */
    function at(uint256 version) public view returns (OracleVersion memory oracleVersion) {
        return _versions[version];
    }

    /**
     * @notice Commits the price represented by `updateData` to the next version that needs to be committed
     * @param updateData The update data to commit
     */
    function commit(bytes calldata updateData) external {
        // This check isn't necessary since the caller would not be able to produce a valid updateData
        // with an update time corresponding to a null version, but reverting with a specific error is
        // clearer.
        if (_nextVersionIndexToCommit >= _versionList.length) revert PythOracleNoNewVersionToCommit();

        uint256 versionToCommit = _versionList[_nextVersionIndexToCommit];

        bytes[] memory updateDataList = new bytes[](1);
        updateDataList[0] = updateData;
        bytes32[] memory priceIdList = new bytes32[](1);
        priceIdList[0] = priceId;
        PythStructs.Price memory pythPrice = pyth.parsePriceFeedUpdates(
            updateDataList,
            priceIdList,
            SafeCast.toUint64(versionToCommit + MIN_VALID_TIME_AFTER_VERSION),
            SafeCast.toUint64(versionToCommit + MAX_VALID_TIME_AFTER_VERSION)
        )[0].price;

        Fixed6 multiplicand = Fixed6Lib.from(pythPrice.price);
        Fixed6 multiplier = Fixed6Lib.from(SafeCast.toInt256(10 ** SafeCast.toUint256(pythPrice.expo > 0 ? pythPrice.expo: -pythPrice.expo)));

        OracleVersion memory oracleVersion = OracleVersion({
            version: versionToCommit,
            timestamp: versionToCommit,
            price: multiplicand.mul(multiplier),
            valid: true
        });
        _versions[versionToCommit] = oracleVersion;
        lastCommittedVersion = oracleVersion;

        ++_nextVersionIndexToCommit;
    }
}
