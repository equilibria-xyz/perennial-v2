// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/perennial-v2-payoff/contracts/interfaces/IPayoffProvider.sol";
import "@equilibria/perennial-v2-oracle/contracts/interfaces/IOracleProvider.sol";
import "@equilibria/root/token/types/Token18.sol";
import "@equilibria/root/number/types/UFixed6.sol";
import "@equilibria/root/curve/types/UJumpRateUtilizationCurve6.sol";
import "@equilibria/root-v2/contracts/PController6.sol";
import "./ProtocolParameter.sol";

/// @dev MarketParameter type
struct MarketParameter {
    UFixed6 fundingFee;
    UFixed6 interestFee;
    UFixed6 positionFee;
    UFixed6 oracleFee; // TODO: move to oracle?
    UFixed6 riskFee;
    UFixed6 settlementFee;
    UFixed6 makerRewardRate;
    UFixed6 longRewardRate;
    UFixed6 shortRewardRate;
    bool takerCloseAlways; // TODO: move to risk?
    bool makerCloseAlways;
    bool closed;
}
using MarketParameterLib for MarketParameter global;
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

library MarketParameterLib {
    error MarketInvalidMarketParameterError(uint256 code);

    function validate(
        MarketParameter memory self,
        ProtocolParameter memory protocolParameter,
        Token18 reward
    ) external pure {
        if (self.settlementFee.gt(protocolParameter.maxFeeAbsolute)) revert MarketInvalidMarketParameterError(2);

        if (self.fundingFee.max(self.interestFee).max(self.positionFee).gt(protocolParameter.maxCut))
            revert MarketInvalidMarketParameterError(3);

        if (self.oracleFee.add(self.riskFee).gt(UFixed6Lib.ONE)) revert MarketInvalidMarketParameterError(8);

        if (
            reward.isZero() &&
            (!self.makerRewardRate.isZero() || !self.longRewardRate.isZero() || !self.shortRewardRate.isZero())
        ) revert MarketInvalidMarketParameterError(9);
    }
}

library MarketParameterStorageLib {
    error MarketParameterStorageInvalidError();

    function read(MarketParameterStorage storage self) external view returns (MarketParameter memory) {
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

    function store(MarketParameterStorage storage self, MarketParameter memory newValue) external {
        if (newValue.fundingFee.gt(UFixed6.wrap(type(uint24).max))) revert MarketParameterStorageInvalidError();
        if (newValue.interestFee.gt(UFixed6.wrap(type(uint24).max))) revert MarketParameterStorageInvalidError();
        if (newValue.positionFee.gt(UFixed6.wrap(type(uint24).max))) revert MarketParameterStorageInvalidError();
        if (newValue.oracleFee.gt(UFixed6.wrap(type(uint24).max))) revert MarketParameterStorageInvalidError();
        if (newValue.riskFee.gt(UFixed6.wrap(type(uint24).max))) revert MarketParameterStorageInvalidError();
        if (newValue.settlementFee.gt(UFixed6.wrap(type(uint32).max))) revert MarketParameterStorageInvalidError();
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