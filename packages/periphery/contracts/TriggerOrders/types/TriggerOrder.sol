// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Fixed6, Fixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { IMarket, OracleVersion, Order, Position } from "@perennial/v2-core/contracts/interfaces/IMarket.sol";
import { InterfaceFee, InterfaceFeeLib } from "./InterfaceFee.sol";

/// @notice Changes a user's position in a market when price reaches a trigger threshold
struct TriggerOrder {
    /// @dev Determines the desired position type to establish or change
    uint8 side;       // 4 = maker, 5 = long, 6 = short
    /// @dev Trigger condition; market price to be less/greater than trigger price
    int8 comparison;  // -1 = lte, 1 = gte
    /// @dev Trigger price used on right hand side of comparison
    Fixed6 price;     // <= 9.22t
    /// @dev Amount to change position by, or type(int64).min to close position
    Fixed6 delta;     // <= 9.22t
    /// @dev Limit on keeper compensation for executing the order
    UFixed6 maxFee;   // < 18.45t
    /// @dev Always leave this false; set true after execution/cancellation
    bool isSpent;
    /// @dev Passed to market for awarding referral fee
    address referrer;
    /// @dev Additive fee optionally awarded to GUIs upon execution
    InterfaceFee interfaceFee;
}
using TriggerOrderLib for TriggerOrder global;

/// @notice Logic for interacting with trigger orders
/// @dev (external-unsafe): this library must be used internally only
library TriggerOrderLib {
    Fixed6 private constant MAGIC_VALUE_CLOSE_POSITION = Fixed6.wrap(type(int64).min);

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
    /// @param account Market participant
    function execute(
        TriggerOrder memory self,
        IMarket market,
        address account
    ) internal {
        // settle and get the pending position of the account
        market.settle(account);
        Order memory pending = market.pendings(account);
        Position memory position = market.positions(account);
        position.update(pending);

        // apply order to position
        if (self.side == 4) position.maker = _add(position.maker, self.delta);
        if (self.side == 5) position.long = _add(position.long, self.delta);
        if (self.side == 6) position.short = _add(position.short, self.delta);

        // apply position to market
        market.update(
            account,
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

    /// @notice Prevents writing invalid side or comparison to storage
    function isValid(TriggerOrder memory self) internal pure returns (bool) {
        return self.side > 3 && self.side < 7 && (self.comparison == -1 || self.comparison == 1);
    }

    function notionalValue(TriggerOrder memory self, IMarket market, address account) internal view returns (UFixed6) {
        // Consistent with how margin requirements are calculated, charge a positive fee on a negative price.
        UFixed6 price = market.oracle().latest().price.abs();
        if (self.delta.eq(MAGIC_VALUE_CLOSE_POSITION)) {
            return _position(market, account, self.side).mul(price);
        } else {
            return self.delta.abs().mul(price);
        }
    }

    /// @notice Helper function to improve readability of TriggerOrderLib.execute
    function _add(UFixed6 lhs, Fixed6 rhs) private pure returns (UFixed6) {
        return rhs.eq(MAGIC_VALUE_CLOSE_POSITION) ?
            UFixed6Lib.ZERO :
            UFixed6Lib.from(Fixed6Lib.from(lhs).add(rhs));
    }

    /// @notice Returns user's position for the side of the order they placed
    function _position(IMarket market, address account, uint8 side) private view returns (UFixed6) {
        Position memory current = market.positions(account);
        Order memory pending = market.pendings(account);
        current.update(pending);

        if (side == 4) return current.maker;
        else if (side == 5) return current.long;
        else if (side == 6) return current.short;
        revert TriggerOrderInvalidError();
    }
}

struct StoredTriggerOrder {
    /* slot 0 */
    uint8 side;                   // 4 = maker, 5 = long, 6 = short
    int8 comparison;              // -1 = lte, 1 = gte
    int64 price;                  // <= 9.22t
    int64 delta;                  // <= 9.22t
    uint64 maxFee;                // < 18.45t
    bool isSpent;
    bytes5 __unallocated0__;      // padding for 32-byte alignment
    /* slot 1 */
    address referrer;
    bytes12 __unallocated1__;     // padding for 32-byte alignment
    /* slot 2 */
    address interfaceFeeReceiver;
    uint64 interfaceFeeAmount;    // < 18.45t
    bool interfaceFeeFlat;
    bool interfaceFeeUnwrap;
    // 2 bytes left over (no need to pad trailing bytes)
}
struct TriggerOrderStorage { StoredTriggerOrder value; }
using TriggerOrderStorageLib for TriggerOrderStorage global;

/// @dev Manually encodes and decodes the TriggerOrder struct to/from storage,
///      and provides facility for hashing for inclusion in EIP-712 messages
/// (external-safe): this library is safe to externalize
library TriggerOrderStorageLib {
    /// @dev Used to verify a signed message
    bytes32 constant public STRUCT_HASH = keccak256(
        "TriggerOrder(uint8 side,int8 comparison,int64 price,int64 delta,uint64 maxFee,bool isSpent,address referrer,InterfaceFee interfaceFee)"
        "InterfaceFee(uint64 amount,address receiver,bool fixedFee,bool unwrap)"
    );

    // sig: 0xf3469aa7
    /// @custom:error price, delta, maxFee, or interface fee amount is out-of-bounds
    error TriggerOrderStorageInvalidError();

    /// @notice reads a trigger order struct from storage
    function read(TriggerOrderStorage storage self) internal view returns (TriggerOrder memory) {
        StoredTriggerOrder memory storedValue = self.value;
        return TriggerOrder(
            uint8(storedValue.side),
            int8(storedValue.comparison),
            Fixed6.wrap(int256(storedValue.price)),
            Fixed6.wrap(int256(storedValue.delta)),
            UFixed6.wrap(uint256(storedValue.maxFee)),
            storedValue.isSpent,
            storedValue.referrer,
            InterfaceFee(
                UFixed6.wrap(uint256(storedValue.interfaceFeeAmount)),
                storedValue.interfaceFeeReceiver,
                storedValue.interfaceFeeFlat,
                storedValue.interfaceFeeUnwrap
            )
        );
    }

    /// @notice writes a trigger order struct to storage
    function store(TriggerOrderStorage storage self, TriggerOrder memory newValue) internal {
        if (!newValue.isValid()) revert TriggerOrderLib.TriggerOrderInvalidError();
        if (newValue.price.gt(Fixed6.wrap(type(int64).max))) revert TriggerOrderStorageInvalidError();
        if (newValue.price.lt(Fixed6.wrap(type(int64).min))) revert TriggerOrderStorageInvalidError();
        if (newValue.delta.gt(Fixed6.wrap(type(int64).max))) revert TriggerOrderStorageInvalidError();
        if (newValue.delta.lt(Fixed6.wrap(type(int64).min))) revert TriggerOrderStorageInvalidError();
        if (newValue.maxFee.gt(UFixed6.wrap(type(uint64).max))) revert TriggerOrderStorageInvalidError();
        if (newValue.interfaceFee.amount.gt(UFixed6.wrap(type(uint64).max))) revert TriggerOrderStorageInvalidError();

        self.value = StoredTriggerOrder(
            uint8(newValue.side),
            int8(newValue.comparison),
            int64(Fixed6.unwrap(newValue.price)),
            int64(Fixed6.unwrap(newValue.delta)),
            uint64(UFixed6.unwrap(newValue.maxFee)),
            newValue.isSpent,
            0,
            newValue.referrer,
            0,
            newValue.interfaceFee.receiver,
            uint64(UFixed6.unwrap(newValue.interfaceFee.amount)),
            newValue.interfaceFee.fixedFee,
            newValue.interfaceFee.unwrap
        );
    }

    /// @notice Used to create a signed message
    function hash(TriggerOrder memory self) internal pure returns (bytes32) {
        return keccak256(abi.encode(
            STRUCT_HASH,
            self.side,
            self.comparison,
            self.price,
            self.delta,
            self.maxFee,
            self.isSpent,
            self.referrer,
            InterfaceFeeLib.hash(self.interfaceFee)
        ));
    }
}
