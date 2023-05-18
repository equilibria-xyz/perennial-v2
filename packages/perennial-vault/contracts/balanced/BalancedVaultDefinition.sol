//SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "../interfaces/IBalancedVaultDefinition.sol";

/**
 * @title BalancedVault
 * @notice ERC4626 vault that manages a 50-50 position between long-short markets of the same payoff on Perennial.
 * @dev Vault deploys and rebalances collateral between the corresponding long and short markets, while attempting to
 *      maintain `targetLeverage` with its open positions at any given time. Deposits are only gated in so much as to cap
 *      the maximum amount of assets in the vault. The long and short markets are expected to have the same oracle and
 *      opposing payoff functions.
 *
 *      The vault has a "delayed mint" mechanism for shares on deposit. After depositing to the vault, a user must wait
 *      until the next settlement of the underlying products in order for shares to be reflected in the getters.
 *      The shares will be fully reflected in contract state when the next settlement occurs on the vault itself.
 *      Similarly, when redeeming shares, underlying assets are not claimable until a settlement occurs.
 *      Each state changing interaction triggers the `settle` flywheel in order to bring the vault to the
 *      desired state.
 *      In the event that there is not a settlement for a long period of time, keepers can call the `sync` method to
 *      force settlement and rebalancing. This is most useful to prevent vault liquidation due to PnL changes
 *      causing the vault to be in an unhealthy state (far away from target leverage)
 */
contract BalancedVaultDefinition is IBalancedVaultDefinition {
    IMarket private constant DEFAULT_MARKET = IMarket(address(0));
    uint256 private constant DEFAULT_WEIGHT = 0;
    uint256 private constant MAX_MARKETS = 2;

    /// @dev The address of the Perennial factory contract
    IFactory public immutable factory;

    /// @dev The target leverage amount for the vault
    UFixed18 public immutable targetLeverage;

    /// @dev The collateral cap for the vault
    UFixed18 public immutable maxCollateral;

    /// @dev The underlying asset of the vault
    Token18 public immutable asset;

    /// @dev The number of markets in the vault
    uint256 public immutable totalMarkets;

    /// @dev The sum of the weights of all products in the vault
    uint256 public immutable totalWeight;

    /// @dev The minimum of the weights of all products in the vault
    uint256 public immutable minWeight;

    /// @dev The product corresponding to the long of each payoff
    IMarket private immutable market0;
    IMarket private immutable market1;

    /// @dev The the weight of each given payoff in the vault
    uint256 private immutable weight0;
    uint256 private immutable weight1;

    /**
     * @notice Constructor for BalancedVaultDefinition
     * @param factory_ The factory contract
     * @param targetLeverage_ The target leverage for the vault
     * @param maxCollateral_ The maximum amount of collateral that can be held in the vault
     * @param marketDefinitions_ The market definitions for the vault
     */
    constructor(
        IFactory factory_,
        UFixed18 targetLeverage_,
        UFixed18 maxCollateral_,
        MarketDefinition[] memory marketDefinitions_
    ) {
        if (targetLeverage_.eq(UFixed18Lib.ZERO)) revert BalancedVaultDefinitionZeroTargetLeverageError();
        if (marketDefinitions_.length == 0) revert BalancedVaultDefinitionNoMarketsError();

        factory = factory_;
        asset = marketDefinitions_[0].market.token(); // TODO: this doesn't seem ideal
        targetLeverage = targetLeverage_;
        maxCollateral = maxCollateral_;

        uint256 totalMarkets_ = Math.min(marketDefinitions_.length, MAX_MARKETS);
        uint256 totalWeight_;
        uint256 minWeight_ = type(uint256).max;

        market0 = (totalMarkets_ > 0) ? marketDefinitions_[0].market : DEFAULT_MARKET;
        weight0 = (totalMarkets_ > 0) ? marketDefinitions_[0].weight : DEFAULT_WEIGHT;

        market1 = (totalMarkets_ > 1) ? marketDefinitions_[1].market : DEFAULT_MARKET;
        weight1 = (totalMarkets_ > 1) ? marketDefinitions_[1].weight : DEFAULT_WEIGHT;

        for (uint256 marketId; marketId < totalMarkets_; marketId++) {
            totalWeight_ += marketDefinitions_[marketId].weight;
            if (minWeight_ > marketDefinitions_[marketId].weight) minWeight_ = marketDefinitions_[marketId].weight;
        }

        totalMarkets = totalMarkets_;
        totalWeight = totalWeight_;
        minWeight = minWeight_;
    }

    /**
     * @notice Returns the market definition for a market
     * @param marketId The market ID to get products for
     * @return market The market definition
     */
    function markets(uint256 marketId) public view returns (MarketDefinition memory market) {
        if (totalMarkets > 0 && marketId == 0) return MarketDefinition(market0, weight0);
        if (totalMarkets > 1 && marketId == 1) return MarketDefinition(market1, weight1);

        revert BalancedVaultDefinitionInvalidMarketIdError();
    }
}
