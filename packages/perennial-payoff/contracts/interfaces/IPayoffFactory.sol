// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "./IPayoffProvider.sol";
import "@equilibria/root-v2/contracts/IFactory.sol";

interface IPayoffFactory is IFactory {
    function payoffs(IPayoffProvider) external view returns (bool);
}
