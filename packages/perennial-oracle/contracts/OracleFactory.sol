// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "@equilibria/root/token/types/Token18.sol";
import "@equilibria/root-v2/contracts/Factory.sol";
import "./interfaces/IOracleProviderFactory.sol";
import "./interfaces/IOracleFactory.sol";
import "hardhat/console.sol";

/**
 * @title OracleFactory
 * @notice
 * @dev
 */
contract OracleFactory is IOracleFactory, Factory {
    Token18 incentive;
    UFixed6 public maxClaim;

    mapping(bytes32 => IOracleProvider) public oracles;
    mapping(IOracleProviderFactory => bool) public factories;

    constructor(address implementation_) Factory(implementation_) { }

    /**
     * @notice Initializes the contract state
     */
    function initialize(Token18 incentive_) external initializer(1) {
        __UOwnable__initialize();

        incentive = incentive_;
    }

    function register(IOracleProviderFactory factory) external onlyOwner {
        factories[factory] = true;
    }

    function create(bytes32 id, IOracleProviderFactory factory) external onlyOwner returns (IOracle newOracle) {
        if (!factories[factory]) revert OracleFactoryNotRegisteredError();
        if (oracles[id] != IOracleProvider(address(0))) revert OracleFactoryAlreadyCreatedError();

        IOracleProvider oracleProvider = factory.oracles(id);
        if (oracleProvider == IOracleProvider(address(0))) revert OracleFactoryInvalidIdError();

        newOracle = IOracle(address(_create(abi.encodeCall(IOracle.initialize, (oracleProvider)))));
        oracles[id] = newOracle;

        emit OracleCreated(newOracle, id);
    }

    function update(bytes32 id, IOracleProviderFactory factory) external onlyOwner {
        if (!factories[factory]) revert OracleFactoryNotRegisteredError();
        if (oracles[id] == IOracleProvider(address(0))) revert OracleFactoryNotCreatedError();

        IOracleProvider oracleProvider = factory.oracles(id);
        if (oracleProvider == IOracleProvider(address(0))) revert OracleFactoryInvalidIdError();

        IOracle oracle = IOracle(address(oracles[id]));
        oracle.update(oracleProvider);
    }

    function updateMaxClaim(UFixed6 newMaxClaim) external onlyOwner {
        maxClaim = newMaxClaim;
        emit MaxClaimUpdated(newMaxClaim);
    }

    function claim(UFixed6 amount) external {
        if (amount.gt(maxClaim)) revert OracleFactoryClaimTooLargeError();
        if (!factories[IOracleProviderFactory(msg.sender)]) revert OracleFactoryNotRegisteredError();
        incentive.push(msg.sender, UFixed18Lib.from(amount));
    }
}
