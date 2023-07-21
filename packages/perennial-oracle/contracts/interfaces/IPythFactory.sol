// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/token/types/Token18.sol";
import "@equilibria/root/attribute/interfaces/IFactory.sol";
import "@equilibria/perennial-v2/contracts/interfaces/IOracleProviderFactory.sol";
import "./IPythOracle.sol";
import "./IOracleFactory.sol";

interface IPythFactory is IOracleProviderFactory, IFactory {
    struct Granularity {
        uint64 latestGranularity;
        uint64 currentGranularity;
        uint128 effectiveAfter;
    }

    event GranularityUpdated(uint256 newGranularity, uint256 effectiveAfter);

    error PythFactoryNotInstanceError();
    error PythFactoryInvalidGranularityError();

    function initialize(IOracleFactory oracleFactory) external;
    function create(bytes32 id) external returns (IPythOracle oracle);
    function claim(UFixed6 amount) external;
    function current() external view returns (uint256);
    function granularity() external view returns (Granularity memory);
    function updateGranularity(uint256 newGranularity) external;
}
