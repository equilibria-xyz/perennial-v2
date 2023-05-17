// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/perennial-v2-payoff/contracts/IPayoffProvider.sol";
import "@equilibria/perennial-v2-oracle/contracts/types/OracleVersion.sol";

/// @dev Payoff type
struct Payoff {
    IPayoffProvider provider;
    bool short; // TODO: don't need this
}
using PayoffLib for Payoff global;

/**
 * @title PayoffLib
 * @notice
 * @dev
 */
library PayoffLib {
    function transform(Payoff memory self, OracleVersion memory oracleVersion) internal pure {
        if (address(self.provider) != address(0)) oracleVersion.price = self.provider.payoff(oracleVersion.price);
        if (self.short) oracleVersion.price = oracleVersion.price.mul(Fixed6Lib.NEG_ONE);
    }
}
