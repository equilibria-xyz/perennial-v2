// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Fixed6, Fixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { IMarket, OracleVersion, Order, Position } from "@equilibria/perennial-v2/contracts/interfaces/IMarket.sol";

/// @notice Changes a user's position in a market when price reaches a trigger threshold
struct TriggerOrder {
    /// @dev Determines the desired position type to establish or change
    uint8 side;       // 3 = maker, 4 = long, 5 = short
    /// @dev Trigger condition; market price to be less/greater than trigger price
    int8 comparison;  // -1 = lte, 1 = gte
    /// @dev Trigger price used on right hand side of comparison
    Fixed6 price;     // <= 9.22t
    /// @dev Amount to change position by, or 0 to close position
    Fixed6 delta;     // <= 9.22t
    /// @dev Limit on keeper compensation for executing the order
    UFixed6 maxFee;   // < 18.45t
    /// @dev Passed to market for awarding referral fee
    address referrer;
}
using TriggerOrderLib for TriggerOrder global;

/// @notice Logic for interacting with trigger orders
/// @dev (external-unsafe): this library must be used internally only
library TriggerOrderLib {
    // sig: 0x5b8c7e99
    /// @custom:error side or comparison is not supported
    error TriggerOrderInvalidError();

    /// @notice Determines whether the trigger order is fillable at the latest price
    /// @param self Trigger order
    /// @param latestVersion Latest oracle version
    /// @return Whether the trigger order is fillable
    function canExecute(TriggerOrder memory self, OracleVersion memory latestVersion) internal pure returns (bool) {
        if (!latestVersion.valid) return false;
        if (self.comparison == 1) return latestVersion.price.gte(self.price);
        if (self.comparison == -1) return latestVersion.price.lte(self.price);
        return false;
    }

    /// @notice Applies the order to the user's position and updates the market
    /// @param self Trigger order
    /// @param market Market for which the trigger order was placed
    /// @param user Market participant
    function execute(
        TriggerOrder memory self,
        IMarket market,
        address user
    ) internal {
        // settle and get the pending position of the account
        market.settle(user);
        Order memory pending = market.pendings(user);
        Position memory position = market.positions(user);
        position.update(pending);

        // apply order to position
        if (self.side == 3) position.maker = _add(position.maker, self.delta);
        if (self.side == 4) position.long = _add(position.long, self.delta);
        if (self.side == 5) position.short = _add(position.short, self.delta);

        // apply position to market
        market.update(
            user,
            position.maker,
            position.long,
            position.short,
            Fixed6Lib.ZERO,
            false,
            self.referrer
        );
    }

    /// @notice Determines if the order has been deleted
    /// @param self Trigger order
    /// @return True if order has no function, otherwise false
    function isEmpty(TriggerOrder memory self) internal pure returns (bool) {
        return self.side == 0 && self.comparison == 0 && self.price.isZero() && self.delta.isZero();
    }

    /// @dev Prevents writing invalid side or comparison to storage
    function isValid(TriggerOrder memory self) internal pure returns (bool) {
        return self.side > 2 && self.side < 6 && (self.comparison == -1 || self.comparison == 1);
    }

    /// @dev Helper function to improve readability of TriggerOrderLib.execute
    function _add(UFixed6 lhs, Fixed6 rhs) private returns (UFixed6) {
        return rhs.isZero() ?
            UFixed6Lib.ZERO :
            UFixed6Lib.from(Fixed6Lib.from(lhs).add(rhs));
    }
}

struct StoredTriggerOrder {
    /* slot 0 */
    uint8 side;             // 3 = maker, 4 = long, 5 = short
    int8 comparison;        // -1 = lte, 1 = gte
    int64 price;            // <= 9.22t
    int64 delta;            // <= 9.22t
    uint64 maxFee;          // < 18.45t
    bytes6 __unallocated__; // padding
    /* slot 1 */
    address referrer;
}
struct TriggerOrderStorage { StoredTriggerOrder value; /*uint256 slot0;*/ }
using TriggerOrderStorageLib for TriggerOrderStorage global;

/// @dev Manually encodes and decodes the TriggerOrder struct to/from storage,
///      and provides facility for hashing for inclusion in EIP-712 messages
/// (external-safe): this library is safe to externalize
library TriggerOrderStorageLib {
    /// @dev Used to verify a signed message
    bytes32 constant public STRUCT_HASH = keccak256(
        "TriggerOrder(uint8 side,int8 comparison,int64 price,int64 delta,uint64 maxFee,address referrer)"
    );

    // sig: 0xf3469aa7
    /// @custom:error price, delta, or maxFee is out-of-bounds
    error TriggerOrderStorageInvalidError();

    /// @dev reads a trigger order struct from storage
    function read(TriggerOrderStorage storage self) internal view returns (TriggerOrder memory) {
        StoredTriggerOrder memory storedValue = self.value;
        return TriggerOrder(
            uint8(storedValue.side),
            int8(storedValue.comparison),
            Fixed6.wrap(int256(storedValue.price)),
            Fixed6.wrap(int256(storedValue.delta)),
            UFixed6.wrap(uint256(storedValue.maxFee)),
            storedValue.referrer
        );
    }

    /// @dev writes a trigger order struct to storage
    function store(TriggerOrderStorage storage self, TriggerOrder memory newValue) internal {
        if (!newValue.isValid()) revert TriggerOrderLib.TriggerOrderInvalidError();
        if (newValue.price.gt(Fixed6.wrap(type(int64).max))) revert TriggerOrderStorageInvalidError();
        if (newValue.price.lt(Fixed6.wrap(type(int64).min))) revert TriggerOrderStorageInvalidError();
        if (newValue.delta.gt(Fixed6.wrap(type(int64).max))) revert TriggerOrderStorageInvalidError();
        if (newValue.delta.lt(Fixed6.wrap(type(int64).min))) revert TriggerOrderStorageInvalidError();
        if (newValue.maxFee.gt(UFixed6.wrap(type(uint64).max))) revert TriggerOrderStorageInvalidError();

        self.value = StoredTriggerOrder(
            uint8(newValue.side),
            int8(newValue.comparison),
            int64(Fixed6.unwrap(newValue.price)),
            int64(Fixed6.unwrap(newValue.delta)),
            uint64(UFixed6.unwrap(newValue.maxFee)),
            0,
            newValue.referrer
        );
    }

    /// @dev Used to create a signed message
    function hash(TriggerOrder memory self) internal pure returns (bytes32) {
        return keccak256(abi.encode(STRUCT_HASH, self.side, self.comparison, self.price, self.delta, self.maxFee, self.referrer));
    }
}
