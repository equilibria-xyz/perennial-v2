// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Intent } from "../types/Intent.sol";
import { Fill } from "../types/Fill.sol";

interface IVerifier {
    // sig: 0xb09262f6
    error VerifierInvalidDomainError();
    // sig: 0xb09262f6
    error VerifierInvalidSignatureError();
    // sig: 0xe6784f14
    error VerifierInvalidNonceError();
    // sig: 0x79998279
    error VerifierInvalidGroupError();
    // sig: 0x27661908
    error VerifierInvalidExpiryError();

    event NonceCancelled(address indexed account, uint256 nonce);
    event GroupCancelled(address indexed account, uint256 group);

    function verifyIntent(Intent calldata intent, bytes calldata signature) external returns (address);
    function verifyFill(Fill calldata fill, bytes calldata signature) external returns (address);
    function cancelNonce(uint256 nonce) external;
    function cancelGroup(uint256 group) external;
}