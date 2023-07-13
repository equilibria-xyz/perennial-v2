// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "@equilibria/root-v2/contracts/Factory.sol";
import "@pythnetwork/pyth-sdk-solidity/AbstractPyth.sol";
import "../interfaces/IPythFactory.sol";
import "../interfaces/IOracleFactory.sol";

// TODO: make UKept

/**
 * @title PythRegistry
 * @notice
 * @dev
 */
contract PythFactory is IPythFactory, Factory {
    AggregatorV3Interface public immutable ethTokenChainlinkFeed;
    Token18 public immutable keeperToken;

    IOracleFactory public oracleFactory;

    mapping(IFactory => bool) public callers;
    mapping(bytes32 => IOracleProvider) public oracles;

    /**
     * @notice Initializes the immutable contract state
     * @param implementation_ IPythOracle implementation contract
     * @param chainlinkFeed_ Chainlink price feed for rewarding keeper in DSU
     * @param dsu_ Token to pay the keeper reward in
     */
    constructor(address implementation_, AggregatorV3Interface chainlinkFeed_, Token18 dsu_) Factory(implementation_) {
        ethTokenChainlinkFeed = chainlinkFeed_;
        keeperToken = dsu_;
    }

    /**
     * @notice Initializes the contract state
     */
    function initialize(IOracleFactory oracleFactory_) external initializer(1) {
        __UOwnable__initialize();

        oracleFactory = oracleFactory_;
    }

    function authorize(IFactory factory) external onlyOwner {
        callers[factory] = true;
    }

    function create(bytes32 id) external onlyOwner returns (IPythOracle newOracle) {
        // TODO: checks for validity?

        newOracle = IPythOracle(address(
            _create(abi.encodeCall(IPythOracle.initialize, (id, ethTokenChainlinkFeed, keeperToken)))));
        oracles[id] = newOracle;

        emit OracleCreated(newOracle, id);
    }

    function claim(UFixed6 amount) external onlyInstance {
        oracleFactory.claim(amount);
        keeperToken.push(msg.sender, UFixed18Lib.from(amount));
    }

    function authorized(address caller) external view returns (bool) {
        IInstance callerInstance = IInstance(caller);
        IFactory callerFactory = callerInstance.factory();
        if (!callerFactory.instances(callerInstance)) return false;
        return callers[callerFactory];
    }
}
