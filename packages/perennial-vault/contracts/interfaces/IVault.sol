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

interface IVault is IInstance {
    struct Context {
        // parameters
        UFixed6 settlementFee;
        uint256 totalWeight;

        // markets
        uint256 currentId;
        Registration[] registrations;
        MarketContext[] markets;
        Mapping currentIds;
        Mapping latestIds;

        // state
        VaultParameter parameter;
        Checkpoint currentCheckpoint;
        Checkpoint latestCheckpoint;
        Account global;
        Account local;
    }

    struct MarketContext {
        // latest global
        UFixed6 latestPrice;

        // current global
        UFixed6 currentPosition;
        UFixed6 currentNet;

        // current local
        Fixed6 collateral;
    }

    struct Target {
        Fixed6 collateral;
        UFixed6 position;
    }

    event MarketRegistered(uint256 indexed marketId, IMarket market);
    event MarketUpdated(uint256 indexed marketId, uint256 newWeight, UFixed6 newLeverage);
    event ParameterUpdated(VaultParameter newParameter);
    event Update(address indexed sender, address indexed account, uint256 version, UFixed6 depositAssets, UFixed6 redeemShares, UFixed6 claimAssets);

    error VaultDepositLimitExceededError();
    error VaultRedemptionLimitExceededError();
    error VaultExistingOrderError();
    error VaultMarketExistsError();
    error VaultMarketDoesNotExistError();
    error VaultNotMarketError();
    error VaultIncorrectAssetError();
    error VaultNotOperatorError();
    error VaultNotSingleSidedError();
    error VaultInsufficientMinimumError();

    error AccountStorageInvalidError();
    error CheckpointStorageInvalidError();
    error MappingStorageInvalidError();
    error RegistrationStorageInvalidError();
    error VaultParameterStorageInvalidError();

    function initialize(Token18 asset, IMarket market, string calldata name_) external;
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
    function register(IMarket market) external;
    function updateMarket(uint256 marketId, uint256 newWeight, UFixed6 newLeverage) external;
    function updateParameter(VaultParameter memory newParameter) external;
}
