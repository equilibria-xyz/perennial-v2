// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Intent } from "../types/Intent.sol";
import { Fill } from "../types/Fill.sol";

interface IVerifier {
    error VerifierInvalidDomainError();
    error VerifierInvalidSignatureError();
    error VerifierInvalidNonceError();
    error VerifierInvalidGroupError();
    error VerifierInvalidExpiryError();

    event NonceCancelled(address indexed account, uint256 nonce);
    event GroupCancelled(address indexed account, uint256 group);

    function verifyIntent(Intent calldata intent, bytes calldata signature) external returns (address);
    function verifyFill(Fill calldata fill, bytes calldata signature) external returns (address);
    function cancelNonce(uint256 nonce) external;
    function cancelGroup(uint256 group) external;
}