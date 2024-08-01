// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/token/types/Token18.sol";
import "@equilibria/root/attribute/interfaces/IFactory.sol";
import "@equilibria/root/attribute/interfaces/IKept.sol";
import "@equilibria/perennial-v2/contracts/interfaces/IOracleProviderFactory.sol";
import "./IKeeperOracle.sol";
import "./IOracleFactory.sol";
import "./IPayoffProvider.sol";
import { KeeperOracleParameter } from "../keeper/types/KeeperOracleParameter.sol";
import { PriceRequest } from "../keeper/types/PriceRequest.sol";

interface IKeeperFactory is IOracleProviderFactory, IFactory, IKept {
    struct PayoffDefinition {
        IPayoffProvider provider;
        int16 decimals;
    }

    struct PriceRecord {
        uint256 timestamp;
        Fixed18 price;
    }

    event OracleAssociated(bytes32 indexed id, bytes32 indexed underlyingId);
    event ParameterUpdated(KeeperOracleParameter newParameter);
    event CallerAuthorized(IFactory indexed caller);
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

    function commitKeepConfig(uint256 numRequested) external view returns (KeepConfig memory);
    function settleKeepConfig() external view returns (KeepConfig memory);

    function initialize(IOracleFactory oracleFactory, AggregatorV3Interface chainlinkFeed_, Token18 dsu_) external;
    function updateId(IOracleProvider oracleProvider, bytes32 id) external;
    function authorize(IFactory factory) external;
    function register(IPayoffProvider payoff) external;
    function toUnderlyingId(bytes32 id) external view returns (bytes32);
    function toUnderlyingPayoff(bytes32 id) external view returns (PayoffDefinition memory payoff);
    function fromUnderlying(bytes32 underlyingId, IPayoffProvider payoff) external view returns (bytes32);
    function create(bytes32 id, bytes32 underlyingId, PayoffDefinition memory payoff) external returns (IKeeperOracle oracle);
    function current() external view returns (uint256);
    function parameter() external view returns (KeeperOracleParameter memory);
    function updateParameter(uint256 newGranularity, UFixed6 newSettlementFee, UFixed6 newOracleFee, uint256 newValidFrom, uint256 newValidTo) external;
    function commit(bytes32[] memory ids, uint256 version, bytes calldata data) external payable;
    function settle(bytes32[] memory ids, IMarket[] memory markets, uint256[] memory versions, uint256[] memory maxCounts) external;
}
