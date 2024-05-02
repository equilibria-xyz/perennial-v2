// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { Common, CommonLib } from "@equilibria/root/verifier/types/Common.sol";
import { VerifierBase } from "@equilibria/root/verifier/VerifierBase.sol";

import { IVerifier } from "./interfaces/IVerifier.sol";
import { DeployAccount, DeployAccountLib } from "./types/DeployAccount.sol";

/// @title Verifier
/// @notice ERC712 signed message verifier for the Perennial V2 Collateral Accounts package.
contract Verifier is VerifierBase, IVerifier {
    /// @dev Initializes the domain separator and parameter caches
    constructor() EIP712("Perennial V2 Collateral Accounts", "1.0.0") { }

    function verifyDeployAccount(DeployAccount calldata deployAccount, bytes calldata signature)
        external
        validateAndCancel(deployAccount.common, signature) returns (address)
    {
        return ECDSA.recover(_hashTypedDataV4(DeployAccountLib.hash(deployAccount)), signature);
    }
}