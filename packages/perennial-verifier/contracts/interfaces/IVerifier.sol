// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { IVerifierBase } from "@equilibria/root/verifier/interfaces/IVerifierBase.sol";
import { Common } from "@equilibria/root/verifier/types/Common.sol";
import { Intent } from "../types/Intent.sol";
import { IMarketFactory } from "./IMarketFactory.sol";
import { OperatorUpdate } from "../types/OperatorUpdate.sol";
import { SignerUpdate } from "../types/SignerUpdate.sol";
import { AccessUpdateBatch } from "../types/AccessUpdateBatch.sol";

interface IVerifier is IVerifierBase {
    error VerifierMarketFactoryZeroAddressError();
    error VerifierInvalidOperatorError();

    function verifyIntent(Intent calldata intent, bytes calldata signature) external;
    function verifyOperatorUpdate(OperatorUpdate calldata operatorUpdate, bytes calldata signature) external;
    function verifySignerUpdate(SignerUpdate calldata signerUpdate, bytes calldata signature) external;
    function verifyAccessUpdateBatch(AccessUpdateBatch calldata accessUpdateBatch, bytes calldata signature) external;
    function updateMarketFactory(IMarketFactory marketFactory) external;
}