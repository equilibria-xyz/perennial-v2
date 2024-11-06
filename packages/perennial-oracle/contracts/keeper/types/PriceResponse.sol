// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { Fixed6 } from "@equilibria/root/number/types/Fixed6.sol";
import { OracleVersion } from "@perennial/v2-core/contracts/types/OracleVersion.sol";
import { OracleReceipt } from "@perennial/v2-core/contracts/types/OracleReceipt.sol";

struct PriceResponse {
    /// @dev The oracle price of the corresponding version
    Fixed6 price;

    /// @dev the synchronous portion of the fixed settlement fee of the request delivered on commit
    UFixed6 syncFee;

    /// @dev the asynchronous portion of the fixed settlement fee of the request delivered on settlement callback
    UFixed6 asyncFee;

    /// @dev The relative oracle fee percentage of the request
    UFixed6 oracleFee;

    /// @dev Whether the version is valid
    bool valid;
}
using PriceResponseLib for PriceResponse global;
struct StoredPriceResponse {
    /* slot 0 */
    int64 price;            // <= 18t
    uint48 syncFee;         // <= 281m
    uint48 asyncFee;        // <= 281m
    uint24 oracleFee;       // <= 100%
    bool valid;
}
struct PriceResponseStorage { StoredPriceResponse value; }
using PriceResponseStorageLib for PriceResponseStorage global;

/// @title PriceResponseLib
/// @dev (external-unsafe): this library must be used internally only
/// @notice Library for PriceResponse logic and data.
library PriceResponseLib {
    /// @notice Constructs a price response from an unrequested oracle version
    /// @param oracleVersion The oracle version object
    /// @return The corresponding price response
    function fromUnrequested(OracleVersion memory oracleVersion) internal pure returns (PriceResponse memory) {
        return PriceResponse(oracleVersion.price, UFixed6Lib.ZERO, UFixed6Lib.ZERO, UFixed6Lib.ZERO, oracleVersion.valid);
    }

    /// @notice Returns an oracle version based on the price snapshot and timestamp
    /// @param self The price response object
    /// @param timestamp The timestamp of the price snapshot
    /// @return The corresponding oracle version
    function toOracleVersion(PriceResponse memory self, uint256 timestamp) internal pure returns (OracleVersion memory) {
        return OracleVersion(timestamp, self.price, self.valid);
    }

    /// @notice Returns an oracle receipt based on the price snapshot and timestamp
    /// @param self The price response object
    /// @param callbacks The number of settlement callbacks to be made
    /// @return The corresponding oracle receipt
    function toOracleReceipt(PriceResponse memory self, uint256 callbacks) internal pure returns (OracleReceipt memory) {
        return OracleReceipt(settlementFee(self, callbacks), self.oracleFee);
    }

    /// @notice Returns the total settlement fee for the price response
    /// @param self The price response object
    /// @param callbacks The number of settlement callbacks to be made
    /// @return The total settlement fee
    function settlementFee(PriceResponse memory self, uint256 callbacks) internal pure returns (UFixed6) {
        return self.syncFee.add(self.asyncFee.mul(UFixed6Lib.from(callbacks)));
    }

    /// @notice Scales down sync and async fees if they exceed the maximum settlement fee
    /// @param self The price response object
    /// @param maxSettlementFee The maximum settlement fee
    function applyFeeMaximum(PriceResponse memory self, UFixed6 maxSettlementFee, uint256 callbacks) internal pure {
        UFixed6 totalSettlementFee = settlementFee(self, callbacks);
        if (totalSettlementFee.gt(maxSettlementFee)) {
            self.syncFee = self.syncFee.muldiv(maxSettlementFee, totalSettlementFee);
            self.asyncFee = self.asyncFee.muldiv(maxSettlementFee, totalSettlementFee);
        }
    }
}

/// @dev (external-safe): this library is safe to externalize
library PriceResponseStorageLib {
    // sig: 0xea04171b
    error PriceResponseStorageInvalidError();

    function read(PriceResponseStorage storage self) internal view returns (PriceResponse memory) {
        StoredPriceResponse memory storedValue = self.value;
        return PriceResponse(
            Fixed6.wrap(int256(storedValue.price)),
            UFixed6.wrap(uint256(storedValue.syncFee)),
            UFixed6.wrap(uint256(storedValue.asyncFee)),
            UFixed6.wrap(uint256(storedValue.oracleFee)),
            storedValue.valid
        );
    }

    function store(PriceResponseStorage storage self, PriceResponse memory newValue) internal {
        if (newValue.price.gt(Fixed6.wrap(type(int64).max))) revert PriceResponseStorageInvalidError();
        if (newValue.price.lt(Fixed6.wrap(type(int64).min))) revert PriceResponseStorageInvalidError();
        if (newValue.syncFee.gt(UFixed6.wrap(type(uint48).max))) revert PriceResponseStorageInvalidError();
        if (newValue.asyncFee.gt(UFixed6.wrap(type(uint48).max))) revert PriceResponseStorageInvalidError();
        if (newValue.oracleFee.gt(UFixed6.wrap(type(uint24).max))) revert PriceResponseStorageInvalidError();

        self.value = StoredPriceResponse(
            int64(Fixed6.unwrap(newValue.price)),
            uint48(UFixed6.unwrap(newValue.syncFee)),
            uint48(UFixed6.unwrap(newValue.asyncFee)),
            uint24(UFixed6.unwrap(newValue.oracleFee)),
            newValue.valid
        );
    }
}
