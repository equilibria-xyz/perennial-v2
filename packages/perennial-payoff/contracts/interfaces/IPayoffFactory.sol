// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "./IPayoffProvider.sol";

interface IPayoffFactory {
    function payoffs(IPayoffProvider) external view returns (bool);
}
