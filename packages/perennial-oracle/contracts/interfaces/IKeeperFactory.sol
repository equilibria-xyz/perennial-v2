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

    event GranularityUpdated(uint256 newGranularity, uint256 effectiveAfter);

    // sig: 0x3d225882
    error KeeperFactoryNotInstanceError();
    // sig: 0xa7cc0264
    error KeeperFactoryInvalidGranularityError();
    // sig: 0xf2f2ce54
    error KeeperFactoryAlreadyCreatedError();
    // sig: 0x22445848
    error KeeperFactoryInvalidIdError();

    function MIN_VALID_TIME_AFTER_VERSION() external view returns (uint256);
    function MAX_VALID_TIME_AFTER_VERSION() external view returns (uint256);
    function KEEPER_REWARD_PREMIUM() external view returns (UFixed18);
    function KEEPER_BUFFER() external view returns (uint256);

    function initialize(IOracleFactory oracleFactory, AggregatorV3Interface chainlinkFeed_, Token18 dsu_) external;
    function create(bytes32 id) external returns (IKeeperOracle oracle);
    function current() external view returns (uint256);
    function granularity() external view returns (Granularity memory);
    function updateGranularity(uint256 newGranularity) external;
    function commit(bytes32[] memory ids, uint256 version, bytes calldata data) external payable;
    function settle(bytes32[] memory ids, IMarket[] memory markets, uint256[] memory versions, uint256[] memory maxCounts) external;
}
