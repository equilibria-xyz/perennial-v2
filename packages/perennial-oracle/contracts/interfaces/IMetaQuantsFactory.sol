// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "./IKeeperFactory.sol";

interface IMetaQuantsFactory is IKeeperFactory {
    error MetaQuantsFactoryInputLengthMismatchError();
    error MetaQuantsFactoryInvalidSignatureError(bytes update, bytes signature);
    error MetaQuantsFactoryInvalidIdError(bytes32 id);
    error MetaQuantsFactoryVersionOutsideRangeError();
}
