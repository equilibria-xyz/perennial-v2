// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Version, VersionStorage } from "../types/Version.sol";
import { Global } from "../types/Global.sol";
import { Order } from "../types/Order.sol";
import { Guarantee } from "../types/Guarantee.sol";
import { OracleVersion } from "../types/OracleVersion.sol";
import { OracleReceipt } from "../types/OracleReceipt.sol";
import { IMarket } from "../interfaces/IMarket.sol";
import { VersionLib, VersionAccumulationResponse } from "../libs/VersionLib.sol";

contract VersionTester {
    VersionStorage public version;

    function read() external view returns (Version memory) {
        return version.read();
    }

    function store(Version memory newVersion) external {
        version.store(newVersion);
    }

    function accumulate(
        IMarket.Context memory context,
        IMarket.SettlementContext memory settlementContext,
        uint256 orderId,
        Order memory order,
        Guarantee memory guarantee,
        OracleVersion memory oracleVersion,
        OracleReceipt memory oracleReceipt
    ) external returns (Global memory nextGlobal, VersionAccumulationResponse memory response) {
        Version memory newVersion = version.read();
        settlementContext.latestVersion = newVersion;

        (newVersion, nextGlobal, response) = VersionLib.accumulate(context, settlementContext, orderId, order, guarantee, oracleVersion, oracleReceipt);

        version.store(newVersion);
    }
}
