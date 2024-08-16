// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "../types/Version.sol";
import "../libs/VersionLib.sol";

contract VersionTester {
    VersionStorage public version;

    function read() external view returns (Version memory) {
        return version.read();
    }

    function store(Version memory newVersion) external {
        version.store(newVersion);
    }

    // function accumulate(
    //     VersionAccumulationContext memory context
    // ) external returns (Global memory nextGlobal, VersionAccumulationResult memory values) {
    //     Version memory newVersion = version.read();

    //     (newVersion, nextGlobal, values) = VersionLib.accumulate(newVersion, context);

    //     version.store(newVersion);
    // }
}
