// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/UFixed6.sol";
import "@equilibria/root/token/types/Token18.sol";
import "@equilibria/root/attribute/interfaces/IInstance.sol";
import "@equilibria/perennial-v2/contracts/interfaces/IOracleProvider.sol";

interface IOracle is IOracleProvider, IInstance {
    // sig: 0x8852e53b
    error OracleOutOfSyncError();
    // sig: 0x0f7338e5
    error OracleOutOfOrderCommitError();
    // sig: 0xb0850572
    error OracleNotSubOracleError();
    // sig: 0xc65186ee
    error OracleNotMarketError();
    // sig: 0x337304b2
    error OracleNotBeneficiaryError();

    event OracleUpdated(IOracleProvider newProvider);
    event MarketUpdated(IMarket newMarket);
    event FeeReceived(UFixed6 settlementFee, UFixed6 oracleFee);
    event BeneficiaryUpdated(address newBeneficiary);

    /// @dev The state for a single epoch
    struct Epoch {
        /// @dev The oracle provider for this epoch
        IOracleProvider provider;

        /// @dev The last timestamp that this oracle provider is valid
        uint96 timestamp;
    }

    /// @dev The global state for oracle
    struct Global {
        /// @dev The current epoch
        uint128 current;

        /// @dev The latest epoch
        uint128 latest;
    }

    function initialize(IOracleProvider initialProvider) external;
    function register(IMarket newMarket) external;
    function update(IOracleProvider newProvider) external;
    function updateBeneficiary(address newBeneficiary) external;
    function claimFee(UFixed6 settlementFeeRequested) external;
    function market() external view returns (IMarket);
    function withdraw(Token18 token) external;
    function beneficiary() external view returns (address);
}