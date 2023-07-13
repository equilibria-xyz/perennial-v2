// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/token/types/Token18.sol";
import "@equilibria/root-v2/contracts/IFactory.sol";
import "./IOracleProviderFactory.sol";
import "./IPythOracle.sol";
import "./IOracleFactory.sol";

interface IPythFactory is IOracleProviderFactory, IFactory {
    error PythFactoryNotInstanceError();

    function initialize(IOracleFactory oracleFactory) external;
    function create(bytes32 id) external returns (IPythOracle oracle);
    function claim(UFixed6 amount) external;
}
