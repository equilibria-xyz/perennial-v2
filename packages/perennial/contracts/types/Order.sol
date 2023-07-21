// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "./OracleVersion.sol";
import "./RiskParameter.sol";
import "./MarketParameter.sol";

/// @dev Order type
struct Order {
    /// @dev The change in the maker position
    Fixed6 maker;

    /// @dev The change in the long position
    Fixed6 long;

    /// @dev The change in the short position
    Fixed6 short;

    /// @dev The change in the net position
    Fixed6 net;

    /// @dev The magnitude of the change in the skew
    UFixed6 skew;

    /// @dev The change of the magnitude in the skew
    Fixed6 impact;

    /// @dev The change in the utilization=
    Fixed6 utilization;

    /// @dev The change in the efficiency
    Fixed6 efficiency;

    /// @dev The fee for the order
    UFixed6 fee;

    /// @dev The fixed settlement fee for the order
    UFixed6 keeper;
}
using OrderLib for Order global;

/// @title Order
/// @notice Holds the state for an account's update order
library OrderLib {
    /// @notice Computes and sets the fee and keeper once an order is already created
    /// @param self The Order object to update
    /// @param latestVersion The latest oracle version
    /// @param marketParameter The market parameter
    /// @param riskParameter The risk parameter
    function registerFee(
        Order memory self,
        OracleVersion memory latestVersion,
        MarketParameter memory marketParameter,
        RiskParameter memory riskParameter
    ) internal pure {
        Fixed6 makerFee = Fixed6Lib.from(riskParameter.makerFee)
            .add(Fixed6Lib.from(riskParameter.makerImpactFee).mul(self.utilization))
            .max(Fixed6Lib.ZERO);
        Fixed6 takerFee = Fixed6Lib.from(riskParameter.takerFee)
            .add(Fixed6Lib.from(riskParameter.takerSkewFee.mul(self.skew)))
            .add(Fixed6Lib.from(riskParameter.takerImpactFee).mul(self.impact))
            .max(Fixed6Lib.ZERO);

        self.fee = self.maker.abs().mul(latestVersion.price.abs()).mul(UFixed6Lib.from(makerFee))
            .add(self.long.abs().add(self.short.abs()).mul(latestVersion.price.abs()).mul(UFixed6Lib.from(takerFee)));

        self.keeper = isEmpty(self) ? UFixed6Lib.ZERO : marketParameter.settlementFee;
    }

    /// @notice Returns whether the order increases any of the account's positions
    /// @return Whether the order increases any of the account's positions
    function increasesPosition(Order memory self) internal pure returns (bool) {
        return self.maker.gt(Fixed6Lib.ZERO) || increasesTaker(self);
    }

    /// @notice Returns whether the order increases the account's long or short positions
    /// @return Whether the order increases the account's long or short positions
    function increasesTaker(Order memory self) internal pure returns (bool) {
        return self.long.gt(Fixed6Lib.ZERO) || self.short.gt(Fixed6Lib.ZERO);
    }

    /// @notice Returns whether the order decreases the liquidity of the market
    /// @return Whether the order decreases the liquidity of the market
    function decreasesLiquidity(Order memory self) internal pure returns (bool) {
        return self.maker.lt(self.net);
    }

    /// @notice Returns whether the order is applicable for liquidity checks
    /// @param self The Order object to check
    /// @param marketParameter The market parameter
    /// @return Whether the order is applicable for liquidity checks
    function liquidityCheckApplicable(
        Order memory self,
        MarketParameter memory marketParameter
    ) internal pure returns (bool) {
        return !marketParameter.closed &&
            !marketParameter.makerCloseAlways &&
            (!marketParameter.takerCloseAlways || increasesTaker(self));
    }

    /// @notice Returns whether the order has no position change
    /// @param self The Order object to check
    /// @return Whether the order has no position change
    function isEmpty(Order memory self) internal pure returns (bool) {
        return self.maker.abs().add(self.long.abs()).add(self.short.abs()).isZero();
    }
}
