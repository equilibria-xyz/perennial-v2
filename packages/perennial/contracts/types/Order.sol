// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/perennial-v2-oracle/contracts/types/OracleVersion.sol";
import "./MarketParameter.sol";
import "hardhat/console.sol";

/// @dev Order type
struct Order {
    Fixed6 maker;
    Fixed6 long;
    Fixed6 short;
    UFixed6 skew;
    Fixed6 impact;
    UFixed6 fee;
}
using OrderLib for Order global;

/**
 * @title OrderLib
 * @notice Library
 */
library OrderLib {
    function registerFee(
        Order memory self,
        OracleVersion memory latestVersion,
        MarketParameter memory marketParameter
    ) internal pure {
        Fixed6 makerFee = Fixed6Lib.from(marketParameter.makerFee)
            .add(Fixed6Lib.from(marketParameter.makerSkewFee.mul(self.skew)))
            .add(Fixed6Lib.from(marketParameter.makerImpactFee).mul(self.impact))
            .max(Fixed6Lib.ZERO);
        Fixed6 takerFee = Fixed6Lib.from(marketParameter.takerFee)
            .add(Fixed6Lib.from(marketParameter.takerSkewFee.mul(self.skew)))
            .add(Fixed6Lib.from(marketParameter.takerImpactFee).mul(self.impact))
            .max(Fixed6Lib.ZERO);

        self.fee = self.maker.abs().mul(latestVersion.price.abs()).mul(UFixed6Lib.from(makerFee))
            .add(self.long.abs().add(self.short.abs()).mul(latestVersion.price.abs()).mul(UFixed6Lib.from(takerFee)));
    }

    function decreasesLiquidity(Order memory self) internal pure returns (bool) {
        return self.maker.lt(Fixed6Lib.ZERO) || self.long.gt(Fixed6Lib.ZERO) || self.short.gt(Fixed6Lib.ZERO);
    }

    function isEmpty(Order memory self) internal pure returns (bool) {
        return self.maker.add(self.long).add(self.short).isZero();
    }
}
