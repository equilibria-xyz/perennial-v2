// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { Fixed6 } from "@equilibria/root/number/types/Fixed6.sol";
import { Common, CommonLib } from "@equilibria/root/verifier/types/Common.sol";

struct Intent {
    /// @dev The size and direction of the order being opened by the taker
    ///       - Positive opens long / Negative opens short
    ///       - The maker will open the opposite side of the order
    ///       - To close, open an order in the opposite direction
    Fixed6 amount;

    /// @dev The price to execute the order at
    Fixed6 price;

    /// @dev The solver fee, a percentage of the substractive interface fee
    UFixed6 fee;

    /// @dev The referral address of the originator of the order (ex. the interface)
    address originator;

    /// @dev The referral address of the solver of the order (ex. the router)
    address solver;

    /// @dev The minimium collateralization ratio that must be maintained after the order is executed
    UFixed6 collateralization;

    /// @dev The common information for the intent
    Common common;
}
using IntentLib for Intent global;

/// @title IntentLib
/// @notice Library for Intent logic and data.
library IntentLib {
    bytes32 constant public STRUCT_HASH = keccak256(
        "Intent(int256 amount,int256 price,uint256 fee,address originator,address solver,uint256 collateralization,Common common)"
        "Common(address account,address signer,address domain,uint256 nonce,uint256 group,uint256 expiry)"
    );

    function hash(Intent memory self) internal pure returns (bytes32) {
        return keccak256(abi.encode(STRUCT_HASH, self.amount, self.price, self.fee, self.originator, self.solver, self.collateralization, CommonLib.hash(self.common)));
    }
}
