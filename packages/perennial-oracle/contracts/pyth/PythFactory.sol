// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "@equilibria/root-v2/contracts/XFactory.sol";
import "@equilibria/root/control/unstructured/UOwnable.sol";
import "@pythnetwork/pyth-sdk-solidity/AbstractPyth.sol";
import "../interfaces/IPythFactory.sol";

/**
 * @title PythRegistry
 * @notice
 * @dev
 */
contract PythFactory is IPythFactory, XFactory, UOwnable {
    mapping(IOracleProvider => bytes32) public ids;
    mapping(bytes32 => IOracleProvider) public oracles;

    /**
     * @notice Initializes the immutable contract state
     * @param implementation_ IPythOracle implementation contract
     */
    constructor(address implementation_) XFactory(implementation_) { }

    /**
     * @notice Initializes the contract state
     */
    function initialize() external initializer(1) {
        __UOwnable__initialize();
    }

    function create(bytes32 id) external onlyOwner returns (IPythOracle oracle) {
        oracle = IPythOracle(_create(abi.encodeCall(IPythOracle.initialize, (id))));
        ids[oracle] = id;
        oracles[id] = oracle;
        emit OracleCreated(oracle, id);
    }
}
