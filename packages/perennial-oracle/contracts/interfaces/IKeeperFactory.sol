// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/token/types/Token18.sol";
import "@equilibria/root/attribute/interfaces/IFactory.sol";
import "@equilibria/root/attribute/interfaces/IKept.sol";
import "@equilibria/perennial-v2/contracts/interfaces/IOracleProviderFactory.sol";
import "./IKeeperOracle.sol";
import "./IOracleFactory.sol";

interface IKeeperFactory is IOracleProviderFactory, IFactory, IKept {
    struct Granularity {
        uint64 latestGranularity;
        uint64 currentGranularity;
        uint128 effectiveAfter;
    }

    event OracleAssociated(bytes32 indexed id, bytes32 indexed underlyingId);
    event GranularityUpdated(uint256 newGranularity, uint256 effectiveAfter);
    event CallerAuthorized(IFactory indexed caller);

    // sig: 0xe65b0914
    error KeeperFactoryNotInstanceError();
    // sig: 0x19136990
    error KeeperFactoryInvalidGranularityError();
    // sig: 0x953ec95c
    error KeeperFactoryAlreadyCreatedError();
    // sig: 0x131b567b
    error KeeperFactoryInvalidIdError();
    // sig: 0x267646d7
    error KeeperFactoryNotAssociatedError();
    // sig: 0xf0253cdc
    error KeeperFactoryAlreadyAssociatedError();

    function validFrom() external view returns (uint256);
    function validTo() external view returns (uint256);
    function keepMultiplierBase() external view returns (UFixed18);
    function keepBufferBase() external view returns (uint256);
    function keepMultiplierData() external view returns (UFixed18);
    function keepBufferData() external view returns (uint256);

    function initialize(IOracleFactory oracleFactory, AggregatorV3Interface chainlinkFeed_, Token18 dsu_) external;
    function authorize(IFactory factory) external;
    function associate(bytes32 id, bytes32 underlyingId) external;
    function toUnderlyingId(bytes32 id) external returns (bytes32);
    function fromUnderlyingId(bytes32 underlyingId) external returns (bytes32);
    function create(bytes32 id) external returns (IKeeperOracle oracle);
    function current() external view returns (uint256);
    function granularity() external view returns (Granularity memory);
    function updateGranularity(uint256 newGranularity) external;
    function commit(bytes32[] memory ids, uint256 version, bytes calldata data) external payable;
    function settle(bytes32[] memory ids, IMarket[] memory markets, uint256[] memory versions, uint256[] memory maxCounts) external;
}
