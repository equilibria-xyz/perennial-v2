// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@equilibria/root/attribute/Factory.sol";
import "@equilibria/root/attribute/Kept/Kept.sol";
import "@pythnetwork/pyth-sdk-solidity/AbstractPyth.sol";
import "../interfaces/IPythFactory.sol";
import "../interfaces/IOracleFactory.sol";

/// @title PythFactory
/// @notice Factory contract for creating and managing Pyth oracles
contract PythFactory is IPythFactory, Factory, Kept {
    /// @dev A Pyth update must come at least this long after a version to be valid
    uint256 constant public MIN_VALID_TIME_AFTER_VERSION = 4 seconds;

    /// @dev A Pyth update must come at most this long after a version to be valid
    uint256 constant public MAX_VALID_TIME_AFTER_VERSION = 10 seconds;

    /// @dev The multiplier for the keeper reward on top of cost
    UFixed18 constant public KEEPER_REWARD_PREMIUM = UFixed18.wrap(3e18);

    /// @dev The fixed gas buffer that is added to the keeper reward
    uint256 constant public KEEPER_BUFFER = 1_000_000;

    /// @notice The maximum value for granularity
    uint256 public constant MAX_GRANULARITY = 1 hours;

    /// @dev Pyth contract
    AbstractPyth public immutable pyth;

    /// @notice The root oracle factory
    IOracleFactory public oracleFactory;

    /// @notice Mapping of which factory's instances are authorized to request from this factory's instances
    mapping(IFactory => bool) public callers;

    /// @notice Mapping of oracle id to oracle instance
    mapping(bytes32 => IOracleProvider) public oracles;

    /// @notice The granularity of the oracle
    Granularity private _granularity;

    /// @notice Initializes the immutable contract state
    /// @param pyth_ Pyth contract
    /// @param implementation_ IPythOracle implementation contract
    constructor(AbstractPyth pyth_, address implementation_) Factory(implementation_) {
        pyth = pyth_;
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
    }

    /// @notice Creates a new oracle instance
    /// @param id The id of the oracle to create
    /// @return newOracle The newly created oracle instance
    function create(bytes32 id) external onlyOwner returns (IPythOracle newOracle) {
        if (oracles[id] != IOracleProvider(address(0))) revert PythFactoryAlreadyCreatedError();
        if (!pyth.priceFeedExists(id)) revert PythFactoryInvalidIdError();

        newOracle = IPythOracle(address(_create(abi.encodeCall(IPythOracle.initialize, (id)))));
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

        for (uint256 i; i < ids.length; i++)
            if (IPythOracle(address(oracles[ids[i]])).commit(OracleVersion(version, prices[i], valid)))
                _handleKeep(ids[i], version, prices[i]);
    }

    /// @notice Performs a list of local settlement callbacks
    /// @dev Pays out a keeper incentive if all supplied local settlement callbacks succeed
    ///      Each array must be the same length, each index is a separate callback entry
    /// @param ids The list of price feed ids to settle
    /// @param markets The list of markets to settle
    /// @param accounts The list of accounts to settle
    /// @param versions The list of versions to settle
    function settle(bytes32[] memory ids, IMarket[] memory markets, address[] accounts, uint256[] versions)
        external
        keep(KEEPER_REWARD_PREMIUM, KEEPER_BUFFER, abi.encode(markets, accounts, versions), "") // TODO: add calldata buffer
    {
        for (uint256 i; i < markets.length; i++)
            IPythOracle(address(oracles[ids[i]])).settle(markets[i], accounts[i], versions[i]);
    }

    /// @notice Handles paying out one instance of a keeper reward for a requested version
    /// @param id The id of the price feed
    /// @param version The oracle version to commit
    /// @param price The price of version to commit
    function _handleKeep(bytes32 id, uint256 version, Fixed6 price)
        private
        keep(KEEPER_REWARD_PREMIUM, KEEPER_BUFFER, abi.encode(id, version, price), "") // TODO: add calldata buffer
    { }

    /// @notice Pulls funds from the factory to reward the keeper
    /// @param keeperFee The keeper fee to pull
    function _raiseKeeperFee(UFixed18 keeperFee, bytes memory) internal virtual override {
        UFixed6 amount = UFixed6Lib.from(keeperFee, true);
        oracleFactory.claim(amount);
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
        if (newGranularity == 0) revert PythFactoryInvalidGranularityError();
        if (_current <= uint256(_granularity.effectiveAfter)) revert PythFactoryInvalidGranularityError();
        if (newGranularity > MAX_GRANULARITY) revert PythFactoryInvalidGranularityError();

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
    ) private returns (Fixed6[] memory prices) {
        prices = new Fixed6[](ids.length);
        bytes[] memory datas = new bytes[](1);
        datas[0] = data;

        PythStructs.PriceFeed[] memory parsedPrices = pyth.parsePriceFeedUpdates{value: msg.value}(
            datas,
            ids,
            SafeCast.toUint64(version + MIN_VALID_TIME_AFTER_VERSION),
            SafeCast.toUint64(version + MAX_VALID_TIME_AFTER_VERSION)
        );

        for (uint256 i; i < parsedPrices.length; i++) {
            (Fixed6 significand, int256 exponent) =
                (Fixed6.wrap(parsedPrices[i].price.price), parsedPrices[i].price.expo + 6);
            Fixed6 base = Fixed6Lib.from(int256(10 ** SignedMath.abs(exponent)));
            prices[i] = exponent < 0 ? significand.div(base) : significand.mul(base);
        }
    }
}
