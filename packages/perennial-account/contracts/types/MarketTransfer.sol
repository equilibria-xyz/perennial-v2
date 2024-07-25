// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Fixed6, Fixed6Lib } from "@equilibria/root/number/types/Fixed6.sol";
import { Action, ActionLib } from "./Action.sol";

struct MarketTransfer {
    /// @dev Identifies the market to which funds should be sent
    address market;
    /// @dev Amount to deposit (positive) or withdraw (negative);
    /// set to Fixed6Lib.MIN to fully withdraw from market.
    Fixed6 amount;
    /// @dev Common information for collateral account actions
    Action action;
}
using MarketTransferLib for MarketTransfer global;

/// @title MarketTransferLib
/// @notice Library used to hash and verify action to move funds to/from a market
library MarketTransferLib {
    /// @dev Used to verify a signed message
    bytes32 constant public STRUCT_HASH = keccak256(
        "MarketTransfer(address market,int256 amount,Action action)"
        "Action(uint256 maxFee,Common common)"
        "Common(address account,address signer,address domain,uint256 nonce,uint256 group,uint256 expiry)"
    );

    /// @dev Used to create a signed message
    function hash(MarketTransfer memory self) internal pure returns (bytes32) {
        return keccak256(abi.encode(STRUCT_HASH, self.market, self.amount, ActionLib.hash(self.action)));
    }
}
