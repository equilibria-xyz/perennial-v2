//SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "@equilibria/root/token/types/Token18.sol";
import "@equilibria/root/token/types/Token6.sol";

contract MockWrapper {
    /// @dev DSU address
    Token18 public immutable DSU; // solhint-disable-line var-name-mixedcase

    /// @dev USDC address
    Token6 public immutable USDC; // solhint-disable-line var-name-mixedcase

    constructor(Token18 dsu_, Token6 usdc_) {
        DSU = dsu_;
        USDC = usdc_;
    }

    function wrap(address to) external {}

    function unwrap(address to) external {}
}
