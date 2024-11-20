// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import { Ownable } from "@equilibria/root/attribute/Ownable.sol";
import { Token18 } from "@equilibria/root/token/types/Token18.sol";
import { UFixed18 } from "@equilibria/root/number/types/UFixed18.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { IInsuranceFund } from "./interfaces/IInsuranceFund.sol";
import { IMarket } from "./interfaces/IMarket.sol";
import { IMarketFactory } from "./interfaces/IMarketFactory.sol";
import { IOracleProvider } from "./interfaces/IOracleProvider.sol";

/// @title InsuranceFund
/// @notice This contract manages the protocol fee and shortfalls for markets.
contract InsuranceFund is IInsuranceFund, Ownable {

    /// @dev The address of the market factory owner.
    IMarketFactory public marketFactory;

    /// @dev The address of the market factory owner.
    address public marketFactoryOwner;

    /// @dev The address of DSU token
    Token18 public DSU;

    /// @inheritdoc IInsuranceFund
    function initialize(IMarketFactory _marketFactory, Token18 _token) external initializer(1) {
        __Ownable__initialize();
        marketFactory = _marketFactory;
        marketFactoryOwner = marketFactory.owner();
        DSU = _token;
    }

    /// @inheritdoc IInsuranceFund
    function claimFees(address market) external {
        if (market == address(0)) revert InsuranceFundInvalidAddress();

        // Check market is created from market factory
        IOracleProvider oracle = IMarket(market).oracle();
        if (market != address(marketFactory.markets(oracle))) revert InsuranceFundInvalidAddress();

        IMarket(market).claimFee(marketFactoryOwner);
    }

    /// @inheritdoc IInsuranceFund
    function resolveShortfall(address market) external onlyOwner {
        if (market == address(0)) revert InsuranceFundInvalidAddress();

        if (IERC20(Token18.unwrap(DSU)).allowance(address(this), market) != type(uint256).max) {
            DSU.approve(market);
        }
        IMarket(market).claimExposure();
    }

    /// @inheritdoc IInsuranceFund
    function sendDSUToMarket(address market, UFixed18 amount) external onlyOwner {
        if (market == address(0)) revert InsuranceFundInvalidAddress();
        if (amount.isZero()) revert InsuranceFundInvalidAmount();
        DSU.push(market, amount);
    }

    /// @inheritdoc IInsuranceFund
    function withdrawDSU(UFixed18 amount) external onlyOwner {
        if (amount.isZero() || DSU.balanceOf(address(this)).lt(amount)) revert InsuranceFundInvalidAmount();
        DSU.push(msg.sender, amount);
    }
}
