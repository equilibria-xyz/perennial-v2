// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { IVerifierBase } from "@equilibria/root/verifier/interfaces/IVerifierBase.sol";
import { Common } from "@equilibria/root/verifier/types/Common.sol";
import { Intent } from "../types/Intent.sol";
import { Fill } from "../types/Fill.sol";
import { OperatorUpdate } from "../types/OperatorUpdate.sol";

interface IVerifier is IVerifierBase {
    function verifyCommon(Common calldata common, bytes calldata signature) external returns (address);
    function verifyIntent(Intent calldata intent, bytes calldata signature) external returns (address);
    function verifyFill(Fill calldata fill, bytes calldata signature) external returns (address);
    function verifyOperatorUpdate(OperatorUpdate calldata operatorUpdate, bytes calldata signature) external returns (address);
}