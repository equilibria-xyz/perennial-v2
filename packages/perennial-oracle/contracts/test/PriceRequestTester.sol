// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "../keeper/types/PriceRequest.sol";

contract PriceRequestTester {
    PriceRequestStorage public priceRequest;

    function read() public view returns (PriceRequest memory) {
        return priceRequest.read();
    }

    function store(PriceRequest memory newPriceRequest) public {
        return priceRequest.store(newPriceRequest);
    }

    function toPriceResponse(
        PriceRequest memory self,
        OracleVersion memory oracleVersion
    ) external pure returns (PriceResponse memory) {
        return PriceRequestLib.toPriceResponse(self, oracleVersion);
    }

    function toPriceResponseInvalid(
        PriceRequest memory self,
        PriceResponse memory latestPriceResponse
    ) external pure returns (PriceResponse memory) {
        return PriceRequestLib.toPriceResponseInvalid(self, latestPriceResponse);
    }
}