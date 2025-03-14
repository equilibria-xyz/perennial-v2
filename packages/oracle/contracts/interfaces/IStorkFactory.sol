// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { IKeeperFactory } from "./IKeeperFactory.sol";

interface IStorkFactory is IKeeperFactory {
    // sig: 0xa9de81b3
    /// @custom:error Update price data and price feed ids array length mismatch
    error StorkFactoryInputLengthMismatchError();

    // sig: 0x4d286c2b
    /// @custom:error Invalid update price data
    error StorkFactoryInvalidSignatureError();

    // sig: 0x16483541
    /// @custom:error update price data ids and input price feed ids mismatch
    error StorkFactoryInvalidIdError();
}
