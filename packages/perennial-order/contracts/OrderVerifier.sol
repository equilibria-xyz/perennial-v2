// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { VerifierBase } from "@equilibria/root/verifier/VerifierBase.sol";

import { IOrderVerifier } from "./interfaces/IOrderVerifier.sol";

contract OrderVerifier is VerifierBase, IOrderVerifier {
    /// @dev Initializes the domain separator and parameter caches
    constructor() EIP712("Perennial V2 Trigger Orders", "1.0.0") { }

    // TODO: implement
}