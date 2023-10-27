// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@equilibria/root/attribute/Factory.sol";
import "@equilibria/root/attribute/Kept/Kept.sol";
import "../interfaces/IKeeperFactory.sol";
import "../interfaces/IOracleFactory.sol";

/// @title KeeperFactory
/// @notice Factory contract for creating and managing keeper-based oracles
abstract contract KeeperFactory is IKeeperFactory, Factory, Kept {
    /// @dev The maximum value for granularity
    uint256 public constant MAX_GRANULARITY = 1 hours;

    /// @dev A Keeper update must come at least this long after a version to be valid
    uint256 public immutable validFrom;

    /// @dev A Keeper update must come at most this long after a version to be valid
    uint256 public immutable validTo;

    /// @dev The multiplier for the keeper reward on top of cost of commit
    UFixed18 internal immutable _keepCommitMultiplierBase;

    /// @dev The fixed gas buffer that is added to the keeper reward for commits
    uint256 internal immutable _keepCommitBufferBase;

    /// @dev The multiplier for the calldata portion of the keeper reward on top of cost of commit
    UFixed18 internal immutable _keepCommitMultiplierCalldata;

    /// @dev The fixed gas buffer that is added to the calldata portion of the keeper reward for commits
    uint256 internal immutable _keepCommitBufferCalldata;

    /// @dev The fixed gas buffer that is added for each incremental update
    uint256 internal immutable _keepCommitIncrementalBufferCalldata;

    /// @dev The multiplier for the keeper reward on top of cost of settle
    UFixed18 internal immutable _keepSettleMultiplierBase;

    /// @dev The fixed gas buffer that is added to the keeper reward for settles
    uint256 internal immutable _keepSettleBufferBase;

    /// @dev The multiplier for the calldata portion of the keeper reward on top of cost of settle
    UFixed18 internal immutable _keepSettleMultiplierCalldata;

    /// @dev The fixed gas buffer that is added to the calldata portion of the keeper reward for settles
    uint256 internal immutable _keepSettleBufferCalldata;

    /// @dev The root oracle factory
    IOracleFactory public oracleFactory;

    /// @dev Mapping of which factory's instances are authorized to request from this factory's instances
    mapping(IFactory => bool) public callers;

    /// @dev Mapping of oracle id to oracle instance
    mapping(bytes32 => IOracleProvider) public oracles;

    /// @dev Mapping of oracle id to underlying id
    mapping(bytes32 => bytes32) public toUnderlyingId;

    /// @dev Mapping of underlying id to oracle id
    mapping(bytes32 => bytes32) public fromUnderlyingId;

    /// @notice The granularity of the oracle
    Granularity private _granularity;

    /// @notice Initializes the immutable contract state
    /// @param implementation_ IKeeperOracle implementation contract
    /// @param validFrom_ The minimum time after a version that a keeper update can be valid
    /// @param validTo_ The maximum time after a version that a keeper update can be valid
    /// @param commitKeepConfig_ Parameter configuration for commit keeper incentivization
    /// @param settleKeepConfig_ Parameter configuration for settle keeper incentivization
    /// @param keepCommitIncrementalBufferCallata_ Calldata buffer amount for each incremental requested update
    constructor(
        address implementation_,
        uint256 validFrom_,
        uint256 validTo_,
        KeepConfig memory commitKeepConfig_,
        KeepConfig memory settleKeepConfig_,
        uint256 keepCommitIncrementalBufferCallata_
    ) Factory(implementation_) {
        validFrom = validFrom_;
        validTo = validTo_;
        _keepCommitMultiplierBase = commitKeepConfig_.multiplierBase;
        _keepCommitBufferBase = commitKeepConfig_.bufferBase;
        _keepCommitMultiplierCalldata = commitKeepConfig_.multiplierCalldata;
        _keepCommitBufferCalldata = commitKeepConfig_.bufferCalldata;
        _keepCommitIncrementalBufferCalldata = keepCommitIncrementalBufferCallata_;
        _keepSettleMultiplierBase = settleKeepConfig_.multiplierBase;
        _keepSettleBufferBase = settleKeepConfig_.bufferBase;
        _keepSettleMultiplierCalldata = settleKeepConfig_.multiplierCalldata;
        _keepSettleBufferCalldata = settleKeepConfig_.bufferCalldata;
    }

    /// @notice Initializes the contract state
    /// @param oracleFactory_ The root oracle factory
    function initialize(
        IOracleFactory oracleFactory_,
        AggregatorV3Interface chainlinkFeed_,
        Token18 dsu_
    ) external initializer(1) {
        __Factory__initialize();
        __Kept__initialize(chainlinkFeed_, dsu_);

        oracleFactory = oracleFactory_;
        _granularity = Granularity(0, 1, 0);
    }

    /// @notice Authorizes a factory's instances to request from this factory's instances
    /// @param factory The factory to authorize
    function authorize(IFactory factory) external onlyOwner {
        callers[factory] = true;
        emit CallerAuthorized(factory);
    }

    /// @notice Associates an oracle id with an underlying id
    /// @param id The oracle id
    /// @param underlyingId The underlying price feed id within the oracle's specific implementation
    function associate(bytes32 id, bytes32 underlyingId) external onlyOwner {
        if (associated(id)) revert KeeperFactoryAlreadyAssociatedError();
        toUnderlyingId[id] = underlyingId;
        fromUnderlyingId[underlyingId] = id;
        emit OracleAssociated(id, underlyingId);
    }

    function associated(bytes32 id) public view returns (bool) {
        return toUnderlyingId[id] != bytes32(0);
    }

    /// @notice Creates a new oracle instance
    /// @param id The id of the oracle to create
    /// @return newOracle The newly created oracle instance
    function create(bytes32 id) public virtual onlyOwner returns (IKeeperOracle newOracle) {
        if (oracles[id] != IOracleProvider(address(0))) revert KeeperFactoryAlreadyCreatedError();
        if (!associated(id)) revert KeeperFactoryNotAssociatedError();

        newOracle = IKeeperOracle(address(_create(abi.encodeCall(IKeeperOracle.initialize, ()))));
        oracles[id] = newOracle;

        emit OracleCreated(newOracle, id);
    }

    /// @notice Returns the current timestamp
    /// @dev Rounded up to the nearest granularity
    /// @return The current timestamp
    function current() public view returns (uint256) {
        uint256 effectiveGranularity = block.timestamp <= uint256(_granularity.effectiveAfter) ?
            uint256(_granularity.latestGranularity) :
            uint256(_granularity.currentGranularity);

        return Math.ceilDiv(block.timestamp, effectiveGranularity) * effectiveGranularity;
    }

    /// @notice Commits the price to specified version
    /// @dev Accepts both requested and non-requested versions.
    ///      Requested versions will pay out a keeper reward, non-requested versions will not.
    ///      Accepts any publish time in the underlying price message, as long as it is within the validity window,
    ///      which means its possible for publish times to be slightly out of order with respect to versions.
    ///      Batched updates are supported by passing in a list of price feed ids along with a valid batch update data.
    /// @param ids The list of price feed ids to commit
    /// @param version The oracle version to commit
    /// @param data The update data to commit
    function commit(bytes32[] memory ids, uint256 version, bytes calldata data) external payable {
        bool valid = data.length != 0;
        Fixed6[] memory prices = valid ? _parsePrices(ids, version, data) : new Fixed6[](ids.length);
        uint256 numRequested;

        for (uint256 i; i < ids.length; i++)
            if (IKeeperOracle(address(oracles[ids[i]])).commit(OracleVersion(version, prices[i], valid)))
                numRequested++;

        if (numRequested != 0) _handleCommitKeep(numRequested);
    }

    /// @notice Returns the keep config for commit
    function commitKeepConfig(uint256 numRequested) public view returns (KeepConfig memory) {
        return KeepConfig(
            _keepCommitMultiplierBase,
            _keepCommitBufferBase * numRequested,
            _keepCommitMultiplierCalldata,
            _keepCommitBufferCalldata + _keepCommitIncrementalBufferCalldata * numRequested
        );
    }

    /// @notice Returns the keep config for settle
    function settleKeepConfig() public view returns (KeepConfig memory) {
        return KeepConfig(
            _keepSettleMultiplierBase,
            _keepSettleBufferBase,
            _keepSettleMultiplierCalldata,
            _keepSettleBufferCalldata
        );
    }

    /// @notice Performs a list of local settlement callbacks
    /// @dev Pays out a keeper incentive if all supplied local settlement callbacks succeed
    ///      Each array must be the same length, each index is a separate corresponding callback entry
    /// @param ids The list of price feed ids to settle
    /// @param markets The list of markets to settle
    /// @param versions The list of versions to settle
    /// @param maxCounts The list of maximum number of settlement callbacks to perform before exiting
    function settle(bytes32[] memory ids, IMarket[] memory markets, uint256[] memory versions, uint256[] memory maxCounts)
        external
        keep(settleKeepConfig(), msg.data, 0, "")
    {
        if (
            ids.length != markets.length ||
            ids.length != versions.length ||
            ids.length != maxCounts.length ||
            // Prevent calldata stuffing
            abi.encodeCall(KeeperFactory.settle, (ids, markets, versions, maxCounts)).length != msg.data.length
        )
            revert KeeperFactoryInvalidSettleError();

        for (uint256 i; i < ids.length; i++)
            IKeeperOracle(address(oracles[ids[i]])).settle(markets[i], versions[i], maxCounts[i]);
    }

    /// @notice Handles paying the keeper requested for given number of requested updates
    /// @param numRequested Number of requested price updates
    function _handleCommitKeep(uint256 numRequested)
        internal virtual
        keep(commitKeepConfig(numRequested), msg.data[0:0], 0, "")
    { }

    /// @notice Pulls funds from the factory to reward the keeper
    /// @param keeperFee The keeper fee to pull
    function _raiseKeeperFee(UFixed18 keeperFee, bytes memory) internal virtual override {
        oracleFactory.claim(UFixed6Lib.from(keeperFee, true));
    }

    /// @notice Returns the granularity
    /// @return The granularity
    function granularity() external view returns (Granularity memory) {
        return _granularity;
    }

    /// @notice Updates the granularity
    /// @param newGranularity The new granularity
    function updateGranularity(uint256 newGranularity) external onlyOwner {
        uint256 _current = current();
        if (newGranularity == 0) revert KeeperFactoryInvalidGranularityError();
        if (_current <= uint256(_granularity.effectiveAfter)) revert KeeperFactoryInvalidGranularityError();
        if (newGranularity > MAX_GRANULARITY) revert KeeperFactoryInvalidGranularityError();

        _granularity = Granularity(
            _granularity.currentGranularity,
            uint64(newGranularity),
            uint128(_current)
        );
        emit GranularityUpdated(newGranularity, _current);
    }

    /// @notice Returns whether a caller is authorized to request from this factory's instances
    /// @param caller The caller to check
    /// @return Whether the caller is authorized
    function authorized(address caller) external view returns (bool) {
        IInstance callerInstance = IInstance(caller);
        IFactory callerFactory = callerInstance.factory();
        if (!callerFactory.instances(callerInstance)) return false;
        return callers[callerFactory];
    }

    /// @notice Validates and parses the update data payload against the specified version
    /// @param ids The list of price feed ids validate against
    /// @param version The oracle version to validate against
    /// @param data The update data to validate
    /// @return prices The parsed price list if valid
    function _parsePrices(
        bytes32[] memory ids,
        uint256 version,
        bytes calldata data
    ) internal virtual returns (Fixed6[] memory prices);
}
