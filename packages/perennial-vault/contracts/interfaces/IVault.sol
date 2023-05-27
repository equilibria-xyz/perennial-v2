//SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/perennial-v2/contracts/interfaces/IFactory.sol";
import "@equilibria/root-v2/contracts/UFixed6.sol";
import "./IVaultDefinition.sol";

interface IVault is IVaultDefinition {

    struct Context {
        uint256 current;
        uint256 latest;

        // markets
        MarketContext[] markets;
    }

    struct MarketContext {
        uint256 currentId;

        // parameter
        bool closed;
        UFixed6 makerLimit;
        IOracleProvider oracle;
        Payoff payoff;

        // current position
        Position currentPosition;

        // latest account position
        uint256 latestVersionAccount;
        UFixed6 latestPositionAccount;

        // current account position
        UFixed6 currentPositionAccount;

        // local
        Fixed18 collateral;
        uint256 liquidation;
    }

    struct Version {
        Basis basis;
        mapping(uint256 => uint256) ids;
    }

    struct Basis {
        UFixed18 shares;
        Fixed18 assets;
    }

    struct Target {
        UFixed18 collateral;
        UFixed6 position;
    }

    event Mint(address indexed account, UFixed18 amount);
    event Burn(address indexed account, UFixed18 amount);
    event Deposit(address indexed sender, address indexed account, uint256 version, UFixed18 assets);
    event Redemption(address indexed sender, address indexed account, uint256 version, UFixed18 shares);
    event Claim(address indexed sender, address indexed account, UFixed18 assets);

    error VaultDepositLimitExceededError();
    error VaultRedemptionLimitExceededError();
    error VaultExistingOrderError();

    function name() external view returns (string memory);
    function initialize(string memory name_) external;
    function settle(address account) external;
    function unclaimed(address account) external view returns (UFixed18);
    function totalUnclaimed() external view returns (UFixed18);
    function claim(address account) external;

    /* Partial ERC4626 Interface */

    function totalAssets() external view returns (UFixed18);
    function convertToShares(UFixed18 assets) external view returns (UFixed18);
    function convertToAssets(UFixed18 shares) external view returns (UFixed18);
    function maxDeposit(address account) external view returns (UFixed18);
    function deposit(UFixed18 assets, address account) external;
    function maxRedeem(address account) external view returns (UFixed18);
    function redeem(UFixed18 shares, address account) external;

    /* Partial ERC20 Interface */

    event Approval(address indexed account, address indexed spender, UFixed18 amount);

    function totalSupply() external view returns (UFixed18);
    function balanceOf(address account) external view returns (UFixed18);
    function allowance(address account, address spender) external view returns (UFixed18);
    function approve(address spender, UFixed18 amount) external returns (bool);
}
