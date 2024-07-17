// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { IAccountVerifier } from "../interfaces/IAccountVerifier.sol";
import { IRelayVerifier } from "../interfaces/IRelayVerifier.sol";

// TODO: consider abandoning this and just have IAccountVerifier be an IRelayVerifier
/// @dev unions interfaces used for locally verifying messages
interface ILocalVerifier is IAccountVerifier, IRelayVerifier {}