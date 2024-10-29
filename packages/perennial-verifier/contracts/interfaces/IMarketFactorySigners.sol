// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;
import "@equilibria/root/number/types/UFixed6.sol";

interface IMarketFactorySigners {
    function signers(address signer, address operator) external view returns (bool);
}
