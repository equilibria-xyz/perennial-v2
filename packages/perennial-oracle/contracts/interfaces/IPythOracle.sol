// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/attribute/interfaces/IInstance.sol";
import "@equilibria/perennial-v2/contracts/interfaces/IOracleProvider.sol";

interface IPythOracle is IOracleProvider, IInstance {
    struct Global {
        /// @dev The latest committed oracle version
        uint64 latestVersion;

        /// @dev Index in `versions` of the most recent version requested
        uint64 currentIndex;

        /// @dev Index in `versions` of the latest version a keeper has committed
        uint64 latestIndex;
    }

    // sig: 0xfd13d773
    error PythOracleInvalidPriceIdError(bytes32 id);
    // sig: 0x9b4e67d3
    error PythOracleVersionOutsideRangeError();
    // sig: 0x877b27c9
    error PythOracleInvalidDataError();

    function initialize(bytes32 id_) external;
    function commit(uint256 version, Fixed6 price) external;
    function next() external returns (uint256);

    function GRACE_PERIOD() external view returns (uint256);
    function versions(uint256 index) external view returns (uint256);
    function global() external view returns (Global memory);
}
