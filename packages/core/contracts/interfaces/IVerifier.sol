// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { IVerifierBase } from "@equilibria/root/verifier/interfaces/IVerifierBase.sol";
import { Common } from "@equilibria/root/verifier/types/Common.sol";
import { Fill } from "../types/Fill.sol";
import { Intent } from "../types/Intent.sol";
import { Take } from "../types/Take.sol";
import { OperatorUpdate } from "../types/OperatorUpdate.sol";
import { SignerUpdate } from "../types/SignerUpdate.sol";
import { AccessUpdateBatch } from "../types/AccessUpdateBatch.sol";

interface IVerifier is IVerifierBase {
    function verifyFill(Fill calldata fill, bytes calldata signature) external;
    function verifyIntent(Intent calldata intent, bytes calldata signature) external;
    function verifyTake(Take calldata marketUpdateTaker, bytes calldata signature) external;
    function verifyOperatorUpdate(OperatorUpdate calldata operatorUpdate, bytes calldata signature) external;
    function verifySignerUpdate(SignerUpdate calldata signerUpdate, bytes calldata signature) external;
    function verifyAccessUpdateBatch(AccessUpdateBatch calldata accessUpdateBatch, bytes calldata signature) external;
}
