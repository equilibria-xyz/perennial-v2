// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { IKeeperFactory } from "./IKeeperFactory.sol";

interface IStorkFactory is IKeeperFactory {
    error StorkFactoryInputLengthMismatchError();
    error StorkFactoryInvalidSignatureError();
    error StorkFactoryInvalidIdError();
}
