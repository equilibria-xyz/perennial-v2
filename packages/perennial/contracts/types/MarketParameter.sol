// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/perennial-v2-payoff/contracts/interfaces/IPayoffProvider.sol";
import "@equilibria/perennial-v2-oracle/contracts/interfaces/IOracleProvider.sol";
import "@equilibria/root/number/types/UFixed6.sol";
import "@equilibria/root/curve/types/UJumpRateUtilizationCurve6.sol";
import "@equilibria/root-v2/contracts/PController6.sol";

/// @dev MarketParameter type
struct MarketParameter {
    UFixed6 fundingFee;
    UFixed6 interestFee;
    UFixed6 positionFee;
    UFixed6 oracleFee; // TODO: move to oracle?
    UFixed6 riskFee;
    bool closed;
}

struct StoredMarketParameter {
    uint24 fundingFee;          // <= 1677%
    uint24 interestFee;         // <= 1677%
    uint24 positionFee;         // <= 1677%
    uint24 oracleFee;           // <= 1677%
    uint24 riskFee;             // <= 1677%
    bool closed;
    bytes16 __unallocated__;
}
struct MarketParameterStorage { StoredMarketParameter value; }
using MarketParameterStorageLib for MarketParameterStorage global;

library MarketParameterStorageLib {
    error MarketParameterStorageInvalidError();

    function read(MarketParameterStorage storage self) internal view returns (MarketParameter memory) {
        StoredMarketParameter memory value = self.value;
        return MarketParameter(
            UFixed6.wrap(uint256(value.fundingFee)),
            UFixed6.wrap(uint256(value.interestFee)),
            UFixed6.wrap(uint256(value.positionFee)),
            UFixed6.wrap(uint256(value.oracleFee)),
            UFixed6.wrap(uint256(value.riskFee)),
            value.closed
        );
    }

    function store(MarketParameterStorage storage self, MarketParameter memory newValue) internal {
        if (newValue.fundingFee.gt(UFixed6.wrap(type(uint24).max))) revert MarketParameterStorageInvalidError();
        if (newValue.interestFee.gt(UFixed6.wrap(type(uint24).max))) revert MarketParameterStorageInvalidError();
        if (newValue.positionFee.gt(UFixed6.wrap(type(uint24).max))) revert MarketParameterStorageInvalidError();
        if (newValue.oracleFee.gt(UFixed6.wrap(type(uint24).max))) revert MarketParameterStorageInvalidError();
        if (newValue.riskFee.gt(UFixed6.wrap(type(uint24).max))) revert MarketParameterStorageInvalidError();

        self.value = StoredMarketParameter(
            uint24(UFixed6.unwrap(newValue.fundingFee)),
            uint24(UFixed6.unwrap(newValue.interestFee)),
            uint24(UFixed6.unwrap(newValue.positionFee)),
            uint24(UFixed6.unwrap(newValue.oracleFee)),
            uint24(UFixed6.unwrap(newValue.riskFee)),
            newValue.closed,
            bytes13(0)
        );
    }
}