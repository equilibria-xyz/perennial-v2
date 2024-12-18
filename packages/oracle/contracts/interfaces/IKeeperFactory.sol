// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { UFixed6 } from "@equilibria/root/number/types/UFixed6.sol";
import { Fixed18 } from "@equilibria/root/number/types/Fixed18.sol";
import { IFactory } from "@equilibria/root/attribute/interfaces/IFactory.sol";
import { IOracleProvider } from "@perennial/v2-core/contracts/interfaces/IOracleProvider.sol";
import { IOracleProviderFactory } from "@perennial/v2-core/contracts/interfaces/IOracleProviderFactory.sol";
import { IGasOracle } from "@equilibria/root/gas/GasOracle.sol";
import { IKeeperOracle } from "./IKeeperOracle.sol";
import { IOracleFactory } from "./IOracleFactory.sol";
import { IPayoffProvider } from "./IPayoffProvider.sol";
import { KeeperOracleParameter } from "../keeper/types/KeeperOracleParameter.sol";

interface IKeeperFactory is IOracleProviderFactory, IFactory {
    struct PayoffDefinition {
        IPayoffProvider provider;
        int16 decimals;
    }

    struct PriceRecord {
        uint256 timestamp;
        Fixed18 price;
        uint256 cost;
    }

    event OracleAssociated(bytes32 indexed id, bytes32 indexed underlyingId);
    event ParameterUpdated(KeeperOracleParameter newParameter);
    event PayoffRegistered(IPayoffProvider indexed payoff);

    // sig: 0xe65b0914
    error KeeperFactoryNotInstanceError();
    // sig: 0xef8e774c
    error KeeperFactoryInvalidParameterError();
    // sig: 0x953ec95c
    error KeeperFactoryAlreadyCreatedError();
    // sig: 0x7e387175
    error KeeperFactoryNotCreatedError();
    // sig: 0x131b567b
    error KeeperFactoryInvalidIdError();
    // sig: 0xb043fd7b
    error KeeperFactoryInvalidSettleError();
    // sig: 0xb2e11555
    error KeeperFactoryInvalidPayoffError();
    // sig: 0x0afa0593
    error KeeperFactoryVersionOutsideRangeError();

    function initialize(IOracleFactory oracleFactory) external;
    function oracleFactory() external view returns (IOracleFactory);
    function factoryType() external view returns (string memory);
    function commitmentGasOracle() external view returns (IGasOracle);
    function settlementGasOracle() external view returns (IGasOracle);
    function register(IPayoffProvider payoff) external;
    function toUnderlyingId(bytes32 oracleId) external view returns (bytes32);
    function toUnderlyingPayoff(bytes32 oracleId) external view returns (PayoffDefinition memory payoff);
    function fromUnderlying(bytes32 underlyingId, IPayoffProvider payoff) external view returns (bytes32);
    function create(bytes32 oracleId, bytes32 underlyingId, PayoffDefinition memory payoff) external returns (IKeeperOracle oracle);
    function current() external view returns (uint256);
    function parameter() external view returns (KeeperOracleParameter memory);
    function updateParameter(uint256 newGranularity, UFixed6 newOracleFee, uint256 newValidFrom, uint256 newValidTo) external;
    function commit(bytes32[] memory oracleIds, uint256 version, bytes calldata data) external payable;
    function settle(bytes32[] memory oracleIds, uint256[] memory versions, uint256[] memory maxCounts) external;
}
