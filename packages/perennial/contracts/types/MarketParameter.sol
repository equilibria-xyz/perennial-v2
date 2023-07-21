// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/token/types/Token18.sol";
import "@equilibria/root/number/types/UFixed6.sol";
import "@equilibria/root/curve/types/UJumpRateUtilizationCurve6.sol";
import "@equilibria/root-v2/contracts/PController6.sol";
import "../interfaces/IOracleProvider.sol";
import "../interfaces/IPayoffProvider.sol";
import "./ProtocolParameter.sol";

/// @dev MarketParameter type
struct MarketParameter {
    /// @dev The fee that is taken out of funding
    UFixed6 fundingFee;

    /// @dev The fee that is taken out of interest
    UFixed6 interestFee;

    /// @dev The fee that is taken out of maker and taker fees
    UFixed6 positionFee;

    /// @dev The share of the collected fees that is paid to the oracle
    UFixed6 oracleFee; // TODO: move to oracle?

    /// @dev The share of the collected fees that is paid to the risk coordinator
    UFixed6 riskFee;

    /// @dev The fixed fee that is charge whenever an oracle request occurs
    UFixed6 settlementFee;

    /// @dev The rate at which the makers receives rewards (share / sec)
    UFixed6 makerRewardRate;

    /// @dev The rate at which the longs receives rewards (share / sec)
    UFixed6 longRewardRate;

    /// @dev The rate at which the shorts receives rewards (share / sec)
    UFixed6 shortRewardRate;

    /// @dev Whether longs and shorts can always close even when they'd put the market into socialization
    bool takerCloseAlways; // TODO: move to risk?

    /// @dev Whether makers can always close even when they'd put the market into socialization
    bool makerCloseAlways;

    /// @dev Whether the market is in close-only mode
    bool closed;
}
struct StoredMarketParameter {
    uint24 fundingFee;          // <= 1677%
    uint24 interestFee;         // <= 1677%
    uint24 positionFee;         // <= 1677%
    uint24 oracleFee;           // <= 1677%
    uint24 riskFee;             // <= 1677%
    uint32 settlementFee;       // <= 4294 // TODO: ??
    uint32 makerRewardRate;     // <= 2147.48 / s
    uint32 longRewardRate;      // <= 2147.48 / s
    uint32 shortRewardRate;     // <= 2147.48 / s
    uint8 flags;
}
struct MarketParameterStorage { StoredMarketParameter value; }
using MarketParameterStorageLib for MarketParameterStorage global;

library MarketParameterStorageLib {
    error MarketParameterStorageInvalidError();

    function read(MarketParameterStorage storage self) internal view returns (MarketParameter memory) {
        StoredMarketParameter memory value = self.value;

        (bool takerCloseAlways, bool makerCloseAlways, bool closed) =
            (value.flags & 0x01 == 0x01, value.flags & 0x02 == 0x02, value.flags & 0x04 == 0x04);

        return MarketParameter(
            UFixed6.wrap(uint256(value.fundingFee)),
            UFixed6.wrap(uint256(value.interestFee)),
            UFixed6.wrap(uint256(value.positionFee)),
            UFixed6.wrap(uint256(value.oracleFee)),
            UFixed6.wrap(uint256(value.riskFee)),
            UFixed6.wrap(uint256(value.settlementFee)),
            UFixed6.wrap(uint256(value.makerRewardRate)),
            UFixed6.wrap(uint256(value.longRewardRate)),
            UFixed6.wrap(uint256(value.shortRewardRate)),
            takerCloseAlways,
            makerCloseAlways,
            closed
        );
    }

    function validate(
        MarketParameter memory self,
        ProtocolParameter memory protocolParameter,
        Token18 reward
    ) internal pure {
        if (self.settlementFee.gt(protocolParameter.maxFeeAbsolute)) revert MarketParameterStorageInvalidError();

        if (self.fundingFee.max(self.interestFee).max(self.positionFee).gt(protocolParameter.maxCut))
            revert MarketParameterStorageInvalidError();

        if (self.oracleFee.add(self.riskFee).gt(UFixed6Lib.ONE)) revert MarketParameterStorageInvalidError();

        if (
            reward.isZero() &&
            (!self.makerRewardRate.isZero() || !self.longRewardRate.isZero() || !self.shortRewardRate.isZero())
        ) revert MarketParameterStorageInvalidError();
    }

    function validateAndStore(
        MarketParameterStorage storage self,
        MarketParameter memory newValue,
        ProtocolParameter memory protocolParameter,
        Token18 reward
    ) internal {
        validate(newValue, protocolParameter, reward);

        if (newValue.makerRewardRate.gt(UFixed6.wrap(type(uint32).max))) revert MarketParameterStorageInvalidError();
        if (newValue.longRewardRate.gt(UFixed6.wrap(type(uint32).max))) revert MarketParameterStorageInvalidError();
        if (newValue.shortRewardRate.gt(UFixed6.wrap(type(uint32).max))) revert MarketParameterStorageInvalidError();

        uint8 flags = (newValue.takerCloseAlways ? 0x01 : 0x00) |
            (newValue.makerCloseAlways ? 0x02 : 0x00) |
            (newValue.closed ? 0x04 : 0x00);

        self.value = StoredMarketParameter(
            uint24(UFixed6.unwrap(newValue.fundingFee)),
            uint24(UFixed6.unwrap(newValue.interestFee)),
            uint24(UFixed6.unwrap(newValue.positionFee)),
            uint24(UFixed6.unwrap(newValue.oracleFee)),
            uint24(UFixed6.unwrap(newValue.riskFee)),
            uint32(UFixed6.unwrap(newValue.settlementFee)),
            uint32(UFixed6.unwrap(newValue.makerRewardRate)),
            uint32(UFixed6.unwrap(newValue.longRewardRate)),
            uint32(UFixed6.unwrap(newValue.shortRewardRate)),
            flags
        );
    }
}