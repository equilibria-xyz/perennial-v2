// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { UFixed6 } from "@equilibria/root/number/types/UFixed6.sol";
import { Fixed6 } from "@equilibria/root/number/types/Fixed6.sol";
import { Common, CommonLib } from "@equilibria/root/verifier/types/Common.sol";

/// @notice Market update which modifies the taker's position without collateral change
struct Take {
    /// @dev Taker delta (positive for long, negative for short)
    Fixed6 amount;
    /// @dev Recipient of referral fee
    address referrer;
    /// @dev Information shared across all EIP712 market actions
    ///      common.account - identifies the user
    ///      common.signer  - user or delegate signing the transaction
    ///      common.domain  - identifies the market
    ///      common.nonce   - per-user unique message identifier
    ///      common.group   - may be used to cancel multiple updates which have not been executed
    ///      common.expiry  - update becomes invalid at and after this time
    Common common;
}
using TakeLib for Take global;

/// @notice Library used to hash requests and verify message signatures
library TakeLib {
    /// @dev Used to verify a signed message
    bytes32 constant public STRUCT_HASH = keccak256(
        "Take(int256 amount,address referrer,Common common)"
        "Common(address account,address signer,address domain,uint256 nonce,uint256 group,uint256 expiry)"
    );

    /// @dev Used to create a signed message
    function hash(Take memory self) internal pure returns (bytes32) {
        return keccak256(abi.encode(STRUCT_HASH, self.amount, self.referrer, CommonLib.hash(self.common)));
    }
}
