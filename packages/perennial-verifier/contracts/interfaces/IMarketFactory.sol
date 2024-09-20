// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;
import "@equilibria/root/number/types/UFixed6.sol";

interface IMarketFactory {
    function authorization(address account, address sender, address signer, address orderReferrer) external view returns (bool, bool, UFixed6);
}
