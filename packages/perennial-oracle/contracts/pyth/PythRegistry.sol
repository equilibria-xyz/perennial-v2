// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "@equilibria/root/control/unstructured/UOwnable.sol";
import "@pythnetwork/pyth-sdk-solidity/AbstractPyth.sol";
import "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
import "../interfaces/IPythOracle.sol";

/**
 * @title PythRegistry
 * @notice
 * @dev
 */
contract PythRegistry is IBeacon, UOwnable {
    event OracleCreated(IPythOracle indexed oracle, bytes32 indexed priceId);

    /// @dev Pyth oracle implementation
    address public immutable implementation;

    mapping(IPythOracle => bool) public isOracle;
    mapping(bytes32 => IPythOracle) public oracles;

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

    function create(bytes32 id) external onlyOwner returns (IPythOracle newOracle) {
        newOracle = IPythOracle(address(new BeaconProxy(address(this), abi.encodeCall(IPythOracle.initialize, (id)))));
        isOracle[newOracle] = true;
        oracles[id] = newOracle;
        emit OracleCreated(newOracle, id);
    }
}
