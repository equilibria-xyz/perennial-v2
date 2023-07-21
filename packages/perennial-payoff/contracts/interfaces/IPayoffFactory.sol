// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root-v2/contracts/IFactory.sol";
import "@equilibria/perennial-v2/contracts/interfaces/IPayoffProvider.sol";

interface IPayoffFactory is IFactory {
    function initialize() external;
}
