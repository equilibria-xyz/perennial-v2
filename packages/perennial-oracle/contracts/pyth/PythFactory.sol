// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "@equilibria/root-v2/contracts/Factory.sol";
import "@pythnetwork/pyth-sdk-solidity/AbstractPyth.sol";
import "../interfaces/IPythFactory.sol";

/**
 * @title PythRegistry
 * @notice
 * @dev
 */
contract PythFactory is IPythFactory, Factory {
    mapping(bytes32 => IOracleProvider) public oracles;

    /**
     * @notice Initializes the immutable contract state
     * @param implementation_ IPythOracle implementation contract
     */
    constructor(address implementation_) Factory(implementation_) { }

    /**
     * @notice Initializes the contract state
     */
    function initialize() external initializer(1) {
        __UOwnable__initialize();
    }

    function create(bytes32 id) external onlyOwner returns (IPythOracle newOracle) {
        // TODO: checks for validity?

        newOracle = IPythOracle(address(_create(abi.encodeCall(IPythOracle.initialize, (id)))));
        oracles[id] = newOracle;

        emit OracleCreated(newOracle, id);
    }
}
