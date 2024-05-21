// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Common } from "../types/Common.sol";
import { Intent } from "../types/Intent.sol";
import { Fill } from "../types/Fill.sol";
import { GroupCancellation } from "../types/GroupCancellation.sol";
import { OperatorUpdate } from "../types/OperatorUpdate.sol";
import { SignerUpdate } from "../types/SignerUpdate.sol";

interface IVerifier {
    // sig: 0xfec563a0
    error VerifierInvalidSignerError();
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

    function verifyCommon(Common calldata common, bytes calldata signature) external returns (address);
    function verifyIntent(Intent calldata intent, bytes calldata signature) external returns (address);
    function verifyFill(Fill calldata fill, bytes calldata signature) external returns (address);
    function verifyGroupCancellation(GroupCancellation calldata groupCancellation, bytes calldata signature) external returns (address);
    function verifyOperatorUpdate(OperatorUpdate calldata operatorUpdate, bytes calldata signature) external returns (address);
    function verifySignerUpdate(SignerUpdate calldata signerUpdate, bytes calldata signature) external returns (address);
    function cancelNonce(uint256 nonce) external;
    function cancelNonceWithSignature(Common calldata common, bytes calldata signature) external;
    function cancelGroup(uint256 group) external;
    function cancelGroupWithSignature(GroupCancellation calldata groupCancellation, bytes calldata signature) external;
}