// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import { Ownable } from "@equilibria/root/attribute/Ownable.sol";
import { Fixed6, Fixed6Lib } from "@equilibria/root/number/types/Fixed6.sol";
import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { IFactory } from "@equilibria/root/attribute/interfaces/IFactory.sol";
import { IInstance } from "@equilibria/root/attribute/interfaces/IInstance.sol";

import { IInsuranceFund } from "./interfaces/IInsuranceFund.sol";
import { IMarket, IMargin } from "./interfaces/IMarket.sol";

/// @title InsuranceFund
/// @notice This contract manages the protocol fee and shortfalls for markets.
contract InsuranceFund is IInsuranceFund, Ownable {

    /// @dev Identifies the deployment, owner, and validates markets
    IFactory public immutable marketFactory;

    /// @dev Manages collateral across markets
    IMargin public immutable margin;

    constructor(IFactory marketFactory_, IMargin margin_) {
        marketFactory = marketFactory_;
        margin = margin_;
    }

    /// @inheritdoc IInsuranceFund
    function initialize() external initializer(1) {
        __Ownable__initialize();
    }

    /// @inheritdoc IInsuranceFund
    function claim(IMarket market) external isMarketInstance(market) {
        // claim fees from market to insurance fund (this contract) collateral balance
        market.claimFee(marketFactory.owner());
        // withdraw fees to caller, reverting if caller is not operator
        margin.claim(address(this), msg.sender);
    }

    /// @inheritdoc IInsuranceFund
    function resolve(address account) external onlyOwner {
        // TODO: settle all cross-margined markets
        Fixed6 resolutionAmount = margin.crossMarginBalances(account).mul(Fixed6Lib.NEG_ONE);
        // reverts if cross-margin balance was not negative or contract balance insufficient
        margin.deposit(account, UFixed6Lib.from(resolutionAmount));
    }

    /// @inheritdoc IInsuranceFund
    function resolveIsolated(IMarket market, address account) external onlyOwner isMarketInstance(market) {
        market.settle(account);
        Fixed6 resolutionAmount = margin.isolatedBalances(account, market).mul(Fixed6Lib.NEG_ONE);
        // reverts if isolated balance was not negative or contract balance insufficient
        market.update(account, Fixed6Lib.ZERO, resolutionAmount, address(0));
    }

    /// @notice Validates that a market was created by the market factory
    /// @param market Market to validate
    modifier isMarketInstance(IMarket market) {
        if (!marketFactory.instances(IInstance(market))) revert InsuranceFundInvalidInstanceError();
        _;
    }
}
