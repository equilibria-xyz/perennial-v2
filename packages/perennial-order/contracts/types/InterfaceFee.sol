// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Fixed6, Fixed6Lib } from "@equilibria/root/number/types/Fixed6.sol";
import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { IMarket } from "@equilibria/perennial-v2/contracts/interfaces/IMarketFactory.sol";

/// @dev Additive fee optionally awarded to GUIs upon execution of trigger orders
struct InterfaceFee {
    /// @dev Amount of DSU to transfer from market to recipient
    UFixed6 amount;
    /// @dev Recipient of the fee
    address receiver;
    /// @dev Whether or not to unwrap the DSU fee to USDC
    bool unwrap; // TODO: currently ignored
}
using InterfaceFeeLib for InterfaceFee global;

/// @dev Library used for EIP-712 message signing and verification of InterfaceFee structs
library InterfaceFeeLib {
    /// @dev Used to verify a signed message
    bytes32 constant public STRUCT_HASH = keccak256(
        "InterfaceFee(uint64 amount,address receiver,bool unwrap)"
    );

    // TODO: should probably move into Manager if we support unwrapping
    /// @notice Charges an interface fee from collateral in this address during an update to a receiver
    /// @param self Interface fee to charge
    /// @param account Account to charge fee from
    /// @param market Market to charge fee from
    function chargeFee(InterfaceFee memory self, address account, IMarket market) internal returns (bool) {
        if (self.amount.isZero()) return false;
        market.update(account, UFixed6Lib.MAX, UFixed6Lib.MAX, UFixed6Lib.MAX, Fixed6Lib.from(-1, self.amount), false);
        return true;
    }

    /// @dev Used to create a signed message
    function hash(InterfaceFee memory self) internal pure returns (bytes32) {
        return keccak256(abi.encode(STRUCT_HASH, self.amount, self.receiver, self.unwrap));
    }
}