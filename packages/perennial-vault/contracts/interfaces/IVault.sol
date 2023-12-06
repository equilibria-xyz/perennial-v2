//SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/attribute/interfaces/IInstance.sol";
import "@equilibria/perennial-v2/contracts/interfaces/IMarket.sol";
import "@equilibria/root/number/types/UFixed6.sol";
import "../types/Account.sol";
import "../types/Checkpoint.sol";
import "../types/Mapping.sol";
import "../types/VaultParameter.sol";
import "../types/Registration.sol";
import "../lib/StrategyLib.sol";

interface IVault is IInstance {
    struct Context {
        // strategy
        Strategy strategy;

        // parameters
        UFixed6 settlementFee;
        uint256 totalWeight;

        // markets
        uint256 currentId;
        Registration[] registrations;
        Fixed6[] collaterals;
        Mapping currentIds;
        Mapping latestIds;

        // state
        VaultParameter parameter;
        Checkpoint currentCheckpoint;
        Checkpoint latestCheckpoint;
        Account global;
        Account local;
    }

    struct Target {
        Fixed6 collateral;
        UFixed6 position;
    }

    event MarketRegistered(uint256 indexed marketId, IMarket market);
    event MarketUpdated(uint256 indexed marketId, uint256 newWeight, UFixed6 newLeverage);
    event ParameterUpdated(VaultParameter newParameter);
    event Updated(address indexed sender, address indexed account, uint256 version, UFixed6 depositAssets, UFixed6 redeemShares, UFixed6 claimAssets);

    // sig: 0xa9785d3d
    error VaultDepositLimitExceededError();
    // sig: 0xc85650f7
    error VaultRedemptionLimitExceededError();
    // sig: 0xe4b29524
    error VaultExistingOrderError();
    // sig: 0x499943cd
    error VaultMarketExistsError();
    // sig: 0x04467fe8
    error VaultMarketDoesNotExistError();
    // sig: 0x7c04a019
    error VaultNotMarketError();
    // sig: 0xaddc4c0d
    error VaultIncorrectAssetError();
    // sig: 0x7eb267c7
    error VaultNotOperatorError();
    // sig: 0xa65ac9fb
    error VaultNotSingleSidedError();
    // sig: 0xa65ac9fb
    error VaultInsufficientMinimumError();

    // sig: 0xb8a09499
    error AccountStorageInvalidError();
    // sig: 0xba85116a
    error CheckpointStorageInvalidError();
    // sig: 0xf003e2c3
    error MappingStorageInvalidError();
    // sig: 0x92f03c86
    error RegistrationStorageInvalidError();
    // sig: 0x0f9f8b19
    error VaultParameterStorageInvalidError();
    // sig: 0x9c8507ac
    error StrategyLibInsufficientMarginError();

    function initialize(Token18 asset, IMarket initialMaker, UFixed6 cap, string calldata name_) external;
    function name() external view returns (string memory);
    function settle(address account) external;
    function update(address account, UFixed6 depositAssets, UFixed6 redeemShares, UFixed6 claimAssets) external;
    function asset() external view returns (Token18);
    function totalAssets() external view returns (Fixed6);
    function totalShares() external view returns (UFixed6);
    function convertToShares(UFixed6 assets) external view returns (UFixed6);
    function convertToAssets(UFixed6 shares) external view returns (UFixed6);
    function totalMarkets() external view returns (uint256);
    function parameter() external view returns (VaultParameter memory);
    function registrations(uint256 marketId) external view returns (Registration memory);
    function accounts(address account) external view returns (Account memory);
    function checkpoints(uint256 id) external view returns (Checkpoint memory);
    function mappings(uint256 id) external view returns (Mapping memory);
    function register(IMarket market) external;
    function updateMarket(uint256 marketId, uint256 newWeight, UFixed6 newLeverage) external;
    function updateParameter(VaultParameter memory newParameter) external;
}
