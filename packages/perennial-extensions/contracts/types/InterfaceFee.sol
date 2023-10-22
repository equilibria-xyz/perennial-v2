// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;
import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";

/// @dev Interface fee type
struct InterfaceFee {
    /// @dev The amount of the fee
    UFixed6 amount;

    /// @dev The address to send the fee to
    address receiver;

    /// @dev Whether or not to unwrap the fee
    bool unwrap;
}
