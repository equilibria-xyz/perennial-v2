// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "../keeper/types/Price.sol";

contract PriceTester {
    PriceStorage public price;

    function read() external view returns (Price memory) {
        return price.read();
    }

    function store(Price memory newPrice) external {
        return price.store(newPrice);
    }
}