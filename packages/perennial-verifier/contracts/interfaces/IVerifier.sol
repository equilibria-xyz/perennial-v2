// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Intent } from "../types/Intent.sol";
import { Fill } from "../types/Fill.sol";

interface IVerifier {
    error VerifierInvalidSignatureError();
    error VerifierInvalidNonceError();
    error VerifierInvalidGroupError();
    error VerifierInvalidExpiryError();

    function verifyIntent(Intent calldata intent, bytes calldata signature) external returns (address);
    function verifyFill(Fill calldata fill, bytes calldata signature) external returns (address);
    function cancelNonce(bytes32 nonce) external;
    function cancelGroup(bytes32 group) external;
}