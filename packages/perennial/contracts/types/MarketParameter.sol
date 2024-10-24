// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { ProtocolParameter } from "./ProtocolParameter.sol";

/// @dev MarketParameter type
struct MarketParameter {
    /// @dev The fee that is taken out of funding
    UFixed6 fundingFee;

    /// @dev The fee that is taken out of interest
    UFixed6 interestFee;

    /// @dev The fee that is taken out of maker and taker fees
    UFixed6 makerFee;

    /// @dev The fee that is taken out of maker and taker fees
    UFixed6 takerFee;

    /// @dev The share of the collected fees that is paid to the risk coordinator
    UFixed6 riskFee;

    /// @dev The maximum amount of orders that can be pending at one time globally
    uint256 maxPendingGlobal;

    /// @dev The maximum amount of orders that can be pending at one time per account
    uint256 maxPendingLocal;

    /// @dev The maximum deviation percentage from the oracle price that is allowed for an intent price override
    UFixed6 maxPriceDeviation;

    /// @dev Whether the market is in close-only mode
    bool closed;

     /// @dev Whether the market is in settle-only mode
    bool settle;
}
struct MarketParameterStorage { uint256 slot0; uint256 slot1; } // SECURITY: must remain at (2) slots
using MarketParameterStorageLib for MarketParameterStorage global;

/// @dev Manually encodes and decodes the MarketParameter struct into storage.
///      (external-safe): this library is safe to externalize
///
///    struct StoredMarketParameter {
///        /* slot 0 */
///        uint24 fundingFee;          // <= 1677%
///        uint24 interestFee;         // <= 1677%
///        uint24 makerFee;            // <= 1677%
///        uint24 takerFee;            // <= 1677%
///        uint24 riskFee;             // <= 1677%
///        uint16 maxPendingGlobal;    // <= 65k
///        uint16 maxPendingLocal;     // <= 65k
///        uint24 maxPriceDeviation;   // <= 1677%
///        uint24 __unallocated__;
///        uint8 flags;
///    }
///
library MarketParameterStorageLib {
    // sig: 0x7c53e926
    error MarketParameterStorageInvalidError();

    function read(MarketParameterStorage storage self) internal view returns (MarketParameter memory) {
        uint256 slot0 = self.slot0;

        uint256 flags = uint256(slot0 << (256 - 24 - 24 - 24 - 24 - 24 - 16 - 16 - 24 - 24 - 8)) >> (256 - 8);
        (bool closed, bool settle) =
            (flags & 0x04 == 0x04, flags & 0x08 == 0x08);

        return MarketParameter(
            UFixed6.wrap(uint256(slot0 << (256 - 24)) >> (256 - 24)),
            UFixed6.wrap(uint256(slot0 << (256 - 24 - 24)) >> (256 - 24)),
            UFixed6.wrap(uint256(slot0 << (256 - 24 - 24 - 24)) >> (256 - 24)),
            UFixed6.wrap(uint256(slot0 << (256 - 24 - 24 - 24 - 24)) >> (256 - 24)),
            UFixed6.wrap(uint256(slot0 << (256 - 24 - 24 - 24 - 24 - 24)) >> (256 - 24)),
                         uint256(slot0 << (256 - 24 - 24 - 24 - 24 - 24 - 16)) >> (256 - 16),
                         uint256(slot0 << (256 - 24 - 24 - 24 - 24 - 24 - 16 - 16)) >> (256 - 16),
            UFixed6.wrap(uint256(slot0 << (256 - 24 - 24 - 24 - 24 - 24 - 16 - 16 - 24)) >> (256 - 24)),
            closed,
            settle
        );
    }

    function validate(MarketParameter memory self, ProtocolParameter memory protocolParameter) private pure {
        if (self.fundingFee.max(self.interestFee).max(self.makerFee).max(self.takerFee).gt(protocolParameter.maxCut))
            revert MarketParameterStorageInvalidError();

        if (self.riskFee.gt(UFixed6Lib.ONE))
            revert MarketParameterStorageInvalidError();
    }

    function validateAndStore(
        MarketParameterStorage storage self,
        MarketParameter memory newValue,
        ProtocolParameter memory protocolParameter
    ) external {
        validate(newValue, protocolParameter);

        if (newValue.maxPendingGlobal > uint256(type(uint16).max)) revert MarketParameterStorageInvalidError();
        if (newValue.maxPendingLocal > uint256(type(uint16).max)) revert MarketParameterStorageInvalidError();
        if (newValue.maxPriceDeviation.gt(UFixed6.wrap(type(uint24).max))) revert MarketParameterStorageInvalidError();

        _store(self, newValue);
    }

    function _store(MarketParameterStorage storage self, MarketParameter memory newValue) private {
        uint256 flags = (newValue.closed ? 0x04 : 0x00) |
            (newValue.settle ? 0x08 : 0x00);

        uint256 encoded0 =
            uint256(UFixed6.unwrap(newValue.fundingFee)         << (256 - 24)) >> (256 - 24) |
            uint256(UFixed6.unwrap(newValue.interestFee)        << (256 - 24)) >> (256 - 24 - 24) |
            uint256(UFixed6.unwrap(newValue.makerFee)           << (256 - 24)) >> (256 - 24 - 24 - 24) |
            uint256(UFixed6.unwrap(newValue.takerFee)           << (256 - 24)) >> (256 - 24 - 24 - 24 - 24) |
            uint256(UFixed6.unwrap(newValue.riskFee)            << (256 - 24)) >> (256 - 24 - 24 - 24 - 24 - 24) |
            uint256(newValue.maxPendingGlobal                   << (256 - 16)) >> (256 - 24 - 24 - 24 - 24 - 24 - 16) |
            uint256(newValue.maxPendingLocal                    << (256 - 16)) >> (256 - 24 - 24 - 24 - 24 - 24 - 16 - 16) |
            uint256(UFixed6.unwrap(newValue.maxPriceDeviation)  << (256 - 24)) >> (256 - 24 - 24 - 24 - 24 - 24 - 16 - 16 - 24) |
            uint256(flags                                       << (256 - 8))  >> (256 - 24 - 24 - 24 - 24 - 24 - 16 - 16 - 24 - 24 - 8);

        assembly {
            sstore(self.slot, encoded0)
        }
    }
}