//SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root-v2/contracts/IInstance.sol";
import "@equilibria/perennial-v2/contracts/interfaces/IMarket.sol";
import "@equilibria/root/number/types/UFixed6.sol";
import "../types/Account.sol";
import "../types/Checkpoint.sol";
import "../types/VaultParameter.sol";
import "../types/Registration.sol";


interface IVault is IInstance {
    struct Context {
        uint256 currentId;
        uint256 latestId;
        uint256 protection;

        // parameters
        UFixed6 makerFee;
        UFixed6 settlementFee;
        UFixed6 minCollateral;
        uint256 minWeight;
        uint256 totalWeight;

        // markets
        MarketContext[] markets;

        // state
        VaultParameter parameter;
        Checkpoint currentCheckpoint;
        Checkpoint latestCheckpoint;
        Account global;
        Account local;
    }

    struct MarketContext {
        // parameter
        Registration registration;
        bool closed;
        UFixed6 makerLimit;

        // latest global
        UFixed6 price;

        // current global
        UFixed6 currentPosition;
        UFixed6 currentNet;

        // latest local
        UFixed6 latestId;
        UFixed6 latestPositionAccount;

        // current local
        UFixed6 currentPositionAccount;
        Fixed6 collateral;
    }

    struct Target {
        Fixed6 collateral;
        UFixed6 position;
    }

    event MarketRegistered(uint256 indexed marketId, IMarket market);
    event WeightUpdated(uint256 indexed marketId, uint256 newWeight);
    event ParameterUpdated(VaultParameter newParameter);
    event Update(address indexed sender, address indexed account, uint256 version, UFixed6 depositAssets, UFixed6 redeemShares, UFixed6 claimAssets);

    error VaultNonTransferableError();
    error VaultDepositLimitExceededError();
    error VaultRedemptionLimitExceededError();
    error VaultExistingOrderError();
    error VaultMarketExistsError();
    error VaultMarketDoesNotExistError();
    error VaultNotOwnerError();
    error VaultNotMarketError();
    error VaultIncorrectAssetError();
    error VaultPausedError();

    error AccountStorageInvalidError();
    error CheckpointStorageInvalidError();
    error RegistrationStorageInvalidError();
    error VaultParameterStorageInvalidError();

    /* parameters */

    function totalMarkets() external view returns (uint256);
    function parameter() external view returns (VaultParameter memory);
    function registrations(uint256 marketId) external view returns (Registration memory);
    function register(IMarket market) external;
    function updateWeight(uint256 marketId, uint256 newWeight) external;
    function updateParameter(VaultParameter memory newParameter) external;

    /* Vault Interface */

    function initialize(Token18 asset, IMarket market, string calldata name_, string calldata symbol_) external;
    function totalShares() external view returns (UFixed6);
    function settle(address account) external;
    function update(address account, UFixed6 depositAssets, UFixed6 redeemShares, UFixed6 claimAssets) external;
    function totalUnclaimed() external view returns (UFixed6);
    function unclaimed(address account) external view returns (UFixed6);

    /* Partial ERC4626 Interface */
    function asset() external view returns (Token18);
    function totalAssets() external view returns (Fixed6);
    function convertToShares(UFixed6 assets) external view returns (UFixed6);
    function convertToAssets(UFixed6 shares) external view returns (UFixed6);

    /* Non-Transferable ERC20 Interface */
    event Approval(address indexed account, address indexed spender, UFixed6 amount);

    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
    function totalSupply() external view returns (UFixed6);
    function balanceOf(address account) external view returns (UFixed6);
    function allowance(address account, address spender) external view returns (UFixed6);
    function approve(address spender, UFixed6 amount) external returns (bool);
    function transfer(address to, UFixed6 amount) external returns (bool);
    function transferFrom(address from, address to, UFixed6 amount) external returns (bool);
}
