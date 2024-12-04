// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import { Ownable } from "@equilibria/root/attribute/Ownable.sol";
import { Token18 } from "@equilibria/root/token/types/Token18.sol";
import { Fixed6, Fixed6Lib } from "@equilibria/root/number/types/Fixed6.sol";
import { IFactory } from "@equilibria/root/attribute/interfaces/IFactory.sol";
import { IInstance } from "@equilibria/root/attribute/interfaces/IInstance.sol";

import { IInsuranceFund } from "./interfaces/IInsuranceFund.sol";
import { IMarket } from "./interfaces/IMarket.sol";

/// @title InsuranceFund
/// @notice This contract manages the protocol fee and shortfalls for markets.
contract InsuranceFund is IInsuranceFund, Ownable {

    /// @dev The address of the market factory
    IFactory public immutable marketFactory;

    /// @dev The address of token
    Token18 public immutable token;

    constructor(IFactory _marketFactory, Token18 _token) {
        marketFactory = _marketFactory;
        token = _token;
    }

    /// @inheritdoc IInsuranceFund
    function initialize() external initializer(1) {
        __Ownable__initialize();
    }

    /// @inheritdoc IInsuranceFund
    function claim(IMarket market) external isMarketInstance(market) {
        market.claimFee(marketFactory.owner());
    }

    /// @inheritdoc IInsuranceFund
    function resolve(IMarket market, address account) external onlyOwner isMarketInstance(market) {
        token.approve(address(market));
        market.settle(account);
        Fixed6 resolutionAmount = market.locals(account).collateral.mul(Fixed6Lib.NEG_ONE);
        market.update(account, Fixed6Lib.ZERO, resolutionAmount, address(0));
    }

    /// @notice Validates that a market was created by the market factory
    /// @param market Market to validate
    modifier isMarketInstance(IMarket market) {
        if (!marketFactory.instances(IInstance(market))) revert InsuranceFundInvalidInstanceError();
        _;
    }
}
