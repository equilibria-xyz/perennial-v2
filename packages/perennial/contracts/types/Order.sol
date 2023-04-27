// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "@equilibria/perennial-v2-oracle/contracts/types/OracleVersion.sol";
import "./MarketParameter.sol";

/// @dev Order type
struct Order {
    Fixed6 maker;
    Fixed6 long;
    Fixed6 short;
}
using OrderLib for Order global;

/**
 * @title OrderLib
 * @notice Library
 */
library OrderLib {
    function fee(
        Order memory self,
        OracleVersion memory currentOracleVersion,
        MarketParameter memory marketParameter
    ) internal pure returns (UFixed6) {
        return self.maker.abs().mul(marketParameter.makerFee)
            .add(self.long.abs().add(self.short.abs()).mul(marketParameter.takerFee))
            .mul(currentOracleVersion.price.abs());
    }

    function decreasesLiquidity(Order memory self) internal pure returns (bool) {
        return self.maker.lt(Fixed6Lib.ZERO) || self.long.gt(Fixed6Lib.ZERO) || self.long.gt(Fixed6Lib.ZERO);
    }
}
