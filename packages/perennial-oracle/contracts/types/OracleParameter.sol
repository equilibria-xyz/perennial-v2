// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/UFixed6.sol";
import "@equilibria/perennial-v2/contracts/types/OracleVersion.sol";

struct OracleParameter {
    /// @dev The cap for the granularity setting in seconds
    uint256 maxGranularity;

    /// @dev the cap for the settle fee in absolute terms
    UFixed6 maxSettlementFee;

    /// @dev The cap for the oracle fee in relative terms
    UFixed6 maxOracleFee;
}
struct StoredOracleParameter {
    uint16 maxGranularity;
    uint48 maxSettlementFee;
    uint24 maxOracleFee;
}
struct OracleParameterStorage { StoredOracleParameter value; }
using OracleParameterStorageLib for OracleParameterStorage global;

library OracleParameterStorageLib {
    // sig: 0xfc481d85
    error OracleParameterStorageInvalidError();

    function read(OracleParameterStorage storage self) internal view returns (OracleParameter memory) {
        StoredOracleParameter memory storedValue = self.value;
        return OracleParameter(
            uint256(storedValue.maxGranularity),
            UFixed6.wrap(uint256(storedValue.maxSettlementFee)),
            UFixed6.wrap(uint256(storedValue.maxOracleFee))
        );
    }

    function validate(OracleParameter memory newValue) private pure {
        if (newValue.maxGranularity < 1) revert OracleParameterStorageInvalidError();
    }

    function store(OracleParameterStorage storage self, OracleParameter memory newValue) internal {
        validate(newValue);

        if (newValue.maxGranularity > type(uint16).max) revert OracleParameterStorageInvalidError();
        if (newValue.maxSettlementFee.gt(UFixed6.wrap(type(uint48).max))) revert OracleParameterStorageInvalidError();
        if (newValue.maxOracleFee.gt(UFixed6.wrap(type(uint24).max))) revert OracleParameterStorageInvalidError();

        self.value = StoredOracleParameter(
            uint16(newValue.maxGranularity),
            uint48(UFixed6.unwrap(newValue.maxSettlementFee)),
            uint24(UFixed6.unwrap(newValue.maxOracleFee))
        );
    }
}
