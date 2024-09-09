// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Fixed6 } from "@equilibria/root/number/types/Fixed6.sol";
import { UFixed6 } from "@equilibria/root/number/types/UFixed6.sol";

/// @dev Additive fee optionally awarded to GUIs upon execution of trigger orders
struct InterfaceFee {
    /// @dev Amount of DSU to transfer from market to recipient
    UFixed6 amount;
    /// @dev Recipient of the fee
    address receiver;
    /// @dev True if fee is a fixed amount, false if fee is percentage of change in notional value
    bool fixedFee;
    /// @dev Whether or not to unwrap the DSU fee to USDC
    bool unwrap;
}
using InterfaceFeeLib for InterfaceFee global;

/// @dev Library used for EIP-712 message signing and verification of InterfaceFee structs
library InterfaceFeeLib {
    /// @dev Used to verify a signed message
    bytes32 constant public STRUCT_HASH = keccak256(
        "InterfaceFee(uint64 amount,address receiver,bool fixedFee,bool unwrap)"
    );

    /// @dev Used to create a signed message
    function hash(InterfaceFee memory self) internal pure returns (bytes32) {
        return keccak256(abi.encode(STRUCT_HASH, self.amount, self.receiver, self.fixedFee, self.unwrap));
    }
}
