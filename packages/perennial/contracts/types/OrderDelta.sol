// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "@equilibria/perennial-v2-oracle/contracts/types/OracleVersion.sol";
import "./MarketParameter.sol";

/// @dev OrderDelta type
struct OrderDelta {
    Fixed6 maker;
    Fixed6 long;
    Fixed6 short;
}
using OrderDeltaLib for OrderDelta global;

/**
 * @title OrderDeltaLib
 * @notice Library
 */
library OrderDeltaLib {
    function fee(
        OrderDelta memory self,
        OracleVersion memory currentOracleVersion,
        MarketParameter memory marketParameter
    ) internal pure returns (UFixed6) {
        return self.maker.abs().mul(marketParameter.makerFee)
            .add(self.long.abs().add(self.short.abs()).mul(marketParameter.takerFee))
            .mul(currentOracleVersion.price.abs());
    }
}
