// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import {PriceResponse, PriceResponseLib, PriceResponseStorage} from "../keeper/types/PriceResponse.sol";
import {OracleVersion} from "@perennial/core/contracts/types/OracleVersion.sol";
import {OracleReceipt} from "@perennial/core/contracts/types/OracleReceipt.sol";

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

    function toOracleVersion(PriceResponse memory self, uint256 timestamp)
        external
        pure
        returns (OracleVersion memory)
    {
        return PriceResponseLib.toOracleVersion(self, timestamp);
    }

    function toOracleReceipt(PriceResponse memory self, uint256 callbacks)
        external
        pure
        returns (OracleReceipt memory)
    {
        return PriceResponseLib.toOracleReceipt(self, callbacks);
    }
}
