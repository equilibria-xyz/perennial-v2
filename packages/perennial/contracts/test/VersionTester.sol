// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "../types/Version.sol";

contract VersionTester {
    VersionStorage public version;

    function read() external view returns (Version memory) {
        return version.read();
    }

    function store(Version memory newVersion) external {
        version.store(newVersion);
    }

    function accumulate(
        Global memory global,
        Position memory fromPosition,
        Position memory toPosition,
        OracleVersion memory fromOracleVersion,
        OracleVersion memory toOracleVersion,
        MarketParameter memory marketParameter,
        RiskParameter memory riskParameter
    ) external returns (VersionAccumulationResult memory values, UFixed6 totalFee) {
        Version memory newVersion = version.read();

        (values, totalFee) = newVersion.accumulate(
            global,
            fromPosition,
            toPosition,
            fromOracleVersion,
            toOracleVersion,
            marketParameter,
            riskParameter
        );

        version.store(newVersion);
    }
}
