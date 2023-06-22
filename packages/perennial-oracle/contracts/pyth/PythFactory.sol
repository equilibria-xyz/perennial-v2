// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "@equilibria/root/control/unstructured/UOwnable.sol";
import "@pythnetwork/pyth-sdk-solidity/AbstractPyth.sol";
import "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
import "../interfaces/IPythOracle.sol";
import "../interfaces/IOracleFactory.sol";

/**
 * @title PythRegistry
 * @notice
 * @dev
 */
contract PythRegistry is IBeacon, IOracleFactory, UOwnable {
    /// @dev Pyth oracle implementation
    address public immutable implementation;

    mapping(IOracleProvider => bytes32) public ids;
    mapping(bytes32 => IOracleProvider) public oracles;

    /**
     * @notice Initializes the immutable contract state
     * @param implementation_ IPythOracle implementation contract
     */
    constructor(address implementation_) {
        implementation = implementation_;
    }

    /**
     * @notice Initializes the contract state
     */
    function initialize() external initializer(1) {
        __UOwnable__initialize();
    }

    function create(bytes32 id) external onlyOwner returns (IOracleProvider oracle) {
        oracle = IOracleProvider(address(new BeaconProxy(address(this), abi.encodeCall(IPythOracle.initialize, (id)))));
        ids[oracle] = id;
        oracles[id] = oracle;
        emit OracleCreated(oracle, id);
    }
}
