// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/perennial-v2-oracle/contracts/types/OracleVersion.sol";
import "./RiskParameter.sol";
import "./MarketParameter.sol";

/// @dev Order type
struct Order {
    Fixed6 maker;
    Fixed6 long;
    Fixed6 short;
    UFixed6 skew;
    Fixed6 impact;
    Fixed6 efficiency;
    UFixed6 fee;
    UFixed6 keeper;
    Fixed6 net;
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
        MarketParameter memory marketParameter,
        RiskParameter memory riskParameter
    ) internal pure {
        Fixed6 makerFee = Fixed6Lib.from(riskParameter.makerFee)
            .add(Fixed6Lib.from(riskParameter.makerImpactFee).mul(self.impact))
            .max(Fixed6Lib.ZERO);
        Fixed6 takerFee = Fixed6Lib.from(riskParameter.takerFee)
            .add(Fixed6Lib.from(riskParameter.takerSkewFee.mul(self.skew)))
            .add(Fixed6Lib.from(riskParameter.takerImpactFee).mul(self.impact))
            .max(Fixed6Lib.ZERO);

        self.fee = self.maker.abs().mul(latestVersion.price.abs()).mul(UFixed6Lib.from(makerFee))
            .add(self.long.abs().add(self.short.abs()).mul(latestVersion.price.abs()).mul(UFixed6Lib.from(takerFee)));

        self.keeper = isEmpty(self) ? UFixed6Lib.ZERO : marketParameter.settlementFee;
    }

    function increasesPosition(Order memory self) internal pure returns (bool) {
        return self.maker.gt(Fixed6Lib.ZERO) || increasesTaker(self);
    }

    function increasesTaker(Order memory self) internal pure returns (bool) {
        return self.long.gt(Fixed6Lib.ZERO) || self.short.gt(Fixed6Lib.ZERO);
    }

    function decreasesLiquidity(Order memory self) internal pure returns (bool) {
        return self.maker.lt(self.net);
    }

    function isEmpty(Order memory self) internal pure returns (bool) {
        return self.maker.add(self.long).add(self.short).isZero();
    }
}
