// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import { Ownable } from "@equilibria/root/attribute/Ownable.sol";
import { Token18 } from "@equilibria/root/token/types/Token18.sol";
import { IFactory } from "@equilibria/root/attribute/interfaces/IFactory.sol";
import { IInstance } from "@equilibria/root/attribute/interfaces/IInstance.sol";

import { IInsuranceFund } from "./interfaces/IInsuranceFund.sol";
import { IMarket } from "./interfaces/IMarket.sol";

/// @title InsuranceFund
/// @notice This contract manages the protocol fee and shortfalls for markets.
contract InsuranceFund is IInsuranceFund, Ownable {

    /// @dev The address of the market factory
    IFactory public immutable marketFactory;

    /// @dev The address of DSU token
    Token18 public immutable DSU;

    constructor(IFactory _marketFactory, Token18 _token) {
        marketFactory = _marketFactory;
        DSU = _token;
    }

    /// @inheritdoc IInsuranceFund
    function initialize() external initializer(1) {
        __Ownable__initialize();
    }

    /// @inheritdoc IInsuranceFund
    function claim(address market) external isMarketInstance(IMarket(market)) {
        IMarket(market).claimFee(marketFactory.owner());
    }

    /// @inheritdoc IInsuranceFund
    function resolve(address market) external onlyOwner isMarketInstance(IMarket(market)) {
        DSU.approve(market);
        IMarket(market).claimExposure();
    }

    /// @notice Validates that a market was created by the market factory
    /// @param market Market to validate
    modifier isMarketInstance(IMarket market) {
        // Check market is created from market factory
        if (!marketFactory.instances(IInstance(market))) revert InsuranceFundInvalidInstanceError();
        _;
    }
}
