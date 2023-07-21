// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "@equilibria/root/attribute/Factory.sol";
import "@pythnetwork/pyth-sdk-solidity/AbstractPyth.sol";
import "../interfaces/IPythFactory.sol";
import "../interfaces/IOracleFactory.sol";

/// @title PythFactory
/// @notice Factory contract for creating and managing Pyth oracles
contract PythFactory is IPythFactory, Factory {
    /// @notice The maximum value for granularity
    uint256 public constant MAX_GRANULARITY = 1 hours;

    /// @notice The legacy Chainlink price feed for ETH/USD used to calculate the keeper reward
    AggregatorV3Interface public immutable ethTokenChainlinkFeed;

    /// @notice The token that is paid out as a reward to oracle keepers
    Token18 public immutable keeperToken;

    /// @notice The root oracle factory
    IOracleFactory public oracleFactory;

    /// @notice Mapping of which factory's instances are authorized to request from this factory's instances
    mapping(IFactory => bool) public callers;

    /// @notice Mapping of oracle id to oracle instance
    mapping(bytes32 => IOracleProvider) public oracles;

    /// @notice The granularity of the oracle
    Granularity private _granularity;

    /// @notice Initializes the immutable contract state
    /// @param implementation_ IPythOracle implementation contract
    /// @param chainlinkFeed_ Chainlink price feed for rewarding keeper in DSU
    /// @param dsu_ Token to pay the keeper reward in
    constructor(address implementation_, AggregatorV3Interface chainlinkFeed_, Token18 dsu_) Factory(implementation_) {
        ethTokenChainlinkFeed = chainlinkFeed_;
        keeperToken = dsu_;
    }

    /// @notice Initializes the contract state
    /// @param oracleFactory_ The root oracle factory
    function initialize(IOracleFactory oracleFactory_) external initializer(1) {
        __UOwnable__initialize();

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
        newOracle = IPythOracle(address(
            _create(abi.encodeCall(IPythOracle.initialize, (id, ethTokenChainlinkFeed, keeperToken)))));
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

    /// @notice Claims an amount of incentive tokens, to be paid out as a reward to the keeper
    /// @dev Can only be called by an instance of the factory
    /// @param amount The amount of tokens to claim
    function claim(UFixed6 amount) external onlyInstance {
        oracleFactory.claim(amount);
        keeperToken.push(msg.sender, UFixed18Lib.from(amount));
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
}
