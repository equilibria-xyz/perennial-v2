// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { UFixed6 } from "@equilibria/root/number/types/UFixed6.sol";
import { PriceResponse, PriceResponseLib, PriceResponseStorage } from "../keeper/types/PriceResponse.sol";
import { OracleVersion } from "@perennial/v2-core/contracts/types/OracleVersion.sol";
import { OracleReceipt } from "@perennial/v2-core/contracts/types/OracleReceipt.sol";

contract PriceResponseTester {
    PriceResponseStorage public priceResponse;

    function read() public view returns (PriceResponse memory) {
        return priceResponse.read();
    }

    function store(PriceResponse memory newPriceResponse) public {
        return priceResponse.store(newPriceResponse);
    }

    function fromUnrequested(OracleVersion memory oracleVersion) external pure returns (PriceResponse memory) {
        return PriceResponseLib.fromUnrequested(oracleVersion);
    }

    function toOracleVersion(PriceResponse memory self, uint256 timestamp) external pure returns (OracleVersion memory) {
        return PriceResponseLib.toOracleVersion(self, timestamp);
    }

    function toOracleReceipt(PriceResponse memory self, uint256 callbacks) external pure returns (OracleReceipt memory) {
        return PriceResponseLib.toOracleReceipt(self, callbacks);
    }

    function settlementFee(PriceResponse memory self, uint256 callbacks) external pure returns (UFixed6) {
        return PriceResponseLib.settlementFee(self, callbacks);
    }

    function applyFeeMaximum(UFixed6 maxSettlementFee, uint256 callbacks) external {
        PriceResponse memory newPriceResponse = read();
        newPriceResponse.applyFeeMaximum(maxSettlementFee, callbacks);
        store(newPriceResponse);
    }
}
