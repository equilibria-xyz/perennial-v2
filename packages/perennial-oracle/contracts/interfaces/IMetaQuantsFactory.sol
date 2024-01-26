// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import "./IKeeperFactory.sol";

interface IMetaQuantsFactory is IKeeperFactory {
    error MetaQuantsFactoryInputLengthMismatchError();
    error MetaQuantsFactoryInvalidSignatureError();
    error MetaQuantsFactoryInvalidIdError();
    error MetaQuantsFactoryVersionOutsideRangeError();
}

struct UpdateAndSignature {
    bytes encodedUpdate;
    bytes signature;
}

struct MetaQuantsUpdate {
    PythStructs.PriceFeed priceFeed;
    uint256 prevPublishTime;
}
