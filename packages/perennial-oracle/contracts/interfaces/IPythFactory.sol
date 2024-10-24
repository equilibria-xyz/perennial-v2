// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { IKeeperFactory } from "./IKeeperFactory.sol";

interface IPythFactory is IKeeperFactory {
    // sig: 0x22445848
    error PythFactoryInvalidIdError();
}

/// @dev PythStaticFee interface, this is not exposed in the AbstractPyth contract
interface IPythStaticFee {
    function singleUpdateFeeInWei() external view returns (uint);
}
