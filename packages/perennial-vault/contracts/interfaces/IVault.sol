//SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/perennial-v2/contracts/interfaces/IFactory.sol";
import "@equilibria/root-v2/contracts/UFixed6.sol";
import "./IVaultDefinition.sol";

interface IVault is IVaultDefinition {

    struct Context {
        uint256 currentId;
        uint256 latestId;
        uint256 currentVersion;
        uint256 latestVersion;
        uint256 liquidation;

        // markets
        MarketContext[] markets;
    }

    struct MarketContext {
        // parameter
        bool closed;
        UFixed6 makerLimit;
        IOracleProvider oracle;
        Payoff payoff;

        // current position
        UFixed6 currentPosition;
        UFixed6 currentNet;

        // latest account position
        UFixed6 latestId;
        UFixed6 latestPositionAccount;

        // current account position
        UFixed6 currentPositionAccount;

        // local
        Fixed6 collateral;
    }

    struct Registration {
        IMarket market;
        uint256 initialId;
    }

    struct Checkpoint {
        BasisStorage _basis;
    }

    struct Basis {
        UFixed18 shares;
        Fixed6 assets;
        bool complete;
    }

    struct BasisStorage {
        uint120 shares;
        int120 assets;
        bool started;
        bool complete;
    }

    struct Target {
        UFixed6 collateral;
        UFixed6 position;
    }

    event Mint(address indexed account, UFixed18 amount);
    event Burn(address indexed account, UFixed18 amount);
    event Deposit(address indexed sender, address indexed account, uint256 version, UFixed6 assets);
    event Redemption(address indexed sender, address indexed account, uint256 version, UFixed6 shares);
    event Claim(address indexed sender, address indexed account, UFixed18 assets);

    error VaultDepositLimitExceededError();
    error VaultRedemptionLimitExceededError();
    error VaultExistingOrderError();
    error VaultMarketMismatchError();

    function name() external view returns (string memory);
    function initialize(string memory name_) external;
    function settle(address account) external;
    function unclaimed(address account) external view returns (UFixed18);
    function totalUnclaimed() external view returns (UFixed18);
    function claim(address account) external;

    /* Partial ERC4626 Interface */

    function totalAssets() external view returns (UFixed6);
    function convertToShares(UFixed6 assets) external view returns (UFixed6);
    function convertToAssets(UFixed6 shares) external view returns (UFixed6);
    function maxDeposit(address account) external view returns (UFixed6);
    function deposit(UFixed6 assets, address account) external;
    function maxRedeem(address account) external view returns (UFixed6);
    function redeem(UFixed6 shares, address account) external;

    /* Partial ERC20 Interface */

    event Approval(address indexed account, address indexed spender, UFixed18 amount);

    function totalSupply() external view returns (UFixed18);
    function balanceOf(address account) external view returns (UFixed18);
    function allowance(address account, address spender) external view returns (UFixed18);
    function approve(address spender, UFixed18 amount) external returns (bool);
}
