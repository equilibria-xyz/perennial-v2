//SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "./interfaces/IVault.sol";
import "@equilibria/root/control/unstructured/UInitializable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./VaultDefinition.sol";
import "./types/Delta.sol";
import "hardhat/console.sol";

/**
 * @title Vault
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
 *
 *      This implementation is designed to be upgrade-compatible with instances of the previous single-payoff
 *      Vault, here: https://github.com/equilibria-xyz/perennial-mono/blob/d970debe95e41598228e8c4ae52fb816797820fb/packages/perennial-vaults/contracts/Vault.sol.
 */
contract Vault is IVault, VaultDefinition, UInitializable {
    /// @dev The name of the vault
    string public name;

    /// @dev Mapping of allowance across all users
    mapping(address => mapping(address => UFixed18)) public allowance;

    /// @dev Mapping of shares of the vault per user
    mapping(address => UFixed18) private _balanceOf;

    /// @dev Total number of shares across all users
    UFixed18 private _totalSupply;

    /// @dev Mapping of unclaimed underlying of the vault per user
    mapping(address => UFixed18) private _unclaimed;

    /// @dev Total unclaimed underlying of the vault across all users
    UFixed18 private _totalUnclaimed;

    /// @dev
    Delta private _delta;

    /// @dev
    mapping(address => Delta) private _deltas;

    /// @dev
    Delta private _pendingDelta;

    /// @dev
    mapping(address => Delta) private _pendingDeltas;

    /// @dev Per-epoch accounting state variables
    mapping(uint256 => Epoch) private _epochs;

    /// @dev Per-asset accounting state variables
    mapping(uint256 => MarketAccount) private _marketAccounts;

    /**
     * @notice Constructor for VaultDefinition
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
    )
    VaultDefinition(factory_, targetLeverage_, maxCollateral_, marketDefinitions_)
    { }

    /**
     * @notice Initializes the contract state
     * @param name_ ERC20 asset name
     */
    function initialize(string memory name_) external initializer(2) {
        name = name_;

        // set or reset allowance compliant with both an initial deployment or an upgrade
        for (uint256 marketId; marketId < totalMarkets; marketId++) {
            asset.approve(address(markets(marketId).market), UFixed18Lib.ZERO);
            asset.approve(address(markets(marketId).market));
        }

        // Stamp new market's data for first epoch
        _pendingDelta.clear(1); // initiate pending at correct epoch (TODO) better way to do this?
        Context memory context  = _settle(address(0));

        for (uint256 marketId; marketId < totalMarkets; marketId++) {
            if (_marketAccounts[marketId].versionOf[context.epoch] == 0)
                _marketAccounts[marketId].versionOf[context.epoch] = context.markets[marketId].latestVersion;
        }
    }

    /**
     * @notice Rebalances the collateral and position of the vault without a deposit or withdraw
     * @dev Should be called by a keeper when a new epoch is available, and there are pending deposits / redemptions
     */
    function sync() external { // TODO: remove
        syncAccount(address(0));
    }

    /**
     * @notice Syncs `account`'s state up to current
     * @dev Also rebalances the collateral and position of the vault without a deposit or withdraw
     * @param account The account that should be synced
     */
    function syncAccount(address account) public {
        Context memory context = _settle(account);
        _rebalance(context, UFixed18Lib.ZERO);
    }

    /**
     * @notice Deposits `assets` assets into the vault, returning shares to `account` after the deposit settles.
     * @param assets The amount of assets to deposit
     * @param account The account to deposit on behalf of
     */
    function deposit(UFixed18 assets, address account) external {
        Context memory context = _settle(account);
        if (assets.gt(_maxDepositAtEpoch(context))) revert VaultDepositLimitExceeded();

        if (_currentEpochStale(context)) {
            _pendingDelta.processDeposit(context.epoch + 1, assets);
            _pendingDeltas[account].processDeposit(context.epoch + 1, assets);
            emit Deposit(msg.sender, account, context.epoch + 1, assets);
        } else {
            _delta.processDeposit(context.epoch, assets);
            _deltas[account].processDeposit(context.epoch, assets);
            emit Deposit(msg.sender, account, context.epoch, assets);
        }

        asset.pull(msg.sender, assets);

        _rebalance(context, UFixed18Lib.ZERO);
    }

    /**
     * @notice Redeems `shares` shares from the vault
     * @dev Does not return any assets to the user due to delayed settlement. Use `claim` to claim assets
     *      If account is not msg.sender, requires prior spending approval
     * @param shares The amount of shares to redeem
     * @param account The account to redeem on behalf of
     */
    function redeem(UFixed18 shares, address account) external {
        if (msg.sender != account) _consumeAllowance(account, msg.sender, shares);

        Context memory context = _settle(account);
        if (shares.gt(_maxRedeemAtEpoch(context, account))) revert VaultRedemptionLimitExceeded();

        if (_currentEpochStale(context)) {
            _pendingDelta.processRedemption(context.epoch + 1, shares);
            _pendingDeltas[account].processRedemption(context.epoch + 1, shares);
            emit Redemption(msg.sender, account, context.epoch + 1, shares);
        } else {
            _delta.processRedemption(context.epoch, shares);
            _deltas[account].processRedemption(context.epoch, shares);
            emit Redemption(msg.sender, account, context.epoch, shares);
        }

        _balanceOf[account] = _balanceOf[account].sub(shares);
        _totalSupply = _totalSupply.sub(shares);

        _rebalance(context, UFixed18Lib.ZERO);
    }

    /**
     * @notice Claims all claimable assets for account, sending assets to account
     * @param account The account to claim for
     */
    function claim(address account) external {
        Context memory context = _settle(account);

        UFixed18 unclaimedAmount = _unclaimed[account];
        UFixed18 unclaimedTotal = _totalUnclaimed;
        _unclaimed[account] = UFixed18Lib.ZERO;
        _totalUnclaimed = unclaimedTotal.sub(unclaimedAmount);
        emit Claim(msg.sender, account, unclaimedAmount);

        // pro-rate if vault has less collateral than unclaimed
        UFixed18 claimAmount = unclaimedAmount;
        UFixed18 totalCollateral = _assets(context);
        if (totalCollateral.lt(unclaimedTotal)) claimAmount = claimAmount.muldiv(totalCollateral, unclaimedTotal);

        _rebalance(context, claimAmount);

        asset.push(account, claimAmount);
    }

    /**
     * @notice Sets `amount` as the allowance of `spender` over the caller's shares
     * @param spender Address which can spend operate on shares
     * @param amount Amount of shares that spender can operate on
     * @return bool true if the approval was successful, otherwise reverts
     */
    function approve(address spender, UFixed18 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    /**
     * @notice The maximum available deposit amount
     * @dev Only exact when vault is synced, otherwise approximate
     * @return Maximum available deposit amount
     */
    function maxDeposit(address) external view returns (UFixed18) {
        return _maxDepositAtEpoch(_loadContextForRead(address(0)));
    }

    /**
     * @notice The maximum available redeemable amount
     * @dev Only exact when vault is synced, otherwise approximate
     * @param account The account to redeem for
     * @return Maximum available redeemable amount
     */
    function maxRedeem(address account) external view returns (UFixed18) {
        return _maxRedeemAtEpoch(_loadContextForRead(account), account);
    }

    /**
     * @notice The total amount of assets currently held by the vault
     * @return Amount of assets held by the vault
     */
    function totalAssets() external view returns (UFixed18) {
        return _totalAssetsAtEpoch(_loadContextForRead(address(0)));
    }

    /**
     * @notice The total amount of shares currently issued
     * @return Amount of shares currently issued
     */
    function totalSupply() external view returns (UFixed18) {
        return _totalSupplyAtEpoch(_loadContextForRead(address(0)));
    }

    /**
     * @notice Number of shares held by `account`
     * @param account Account to query balance of
     * @return Number of shares held by `account`
     */
    function balanceOf(address account) external view returns (UFixed18) {
        return _balanceOfAtEpoch(_loadContextForRead(account), account);
    }

    /**
     * @notice Total unclaimed assets in vault
     * @return Total unclaimed assets in vault
     */
    function totalUnclaimed() external view returns (UFixed18) {
        return _totalUnclaimedAtEpoch(_loadContextForRead(address(0)));
    }

    /**
     * @notice `account`'s unclaimed assets
     * @param account Account to query unclaimed balance of
     * @return `account`'s unclaimed assets
     */
    function unclaimed(address account) external view returns (UFixed18) {
        return _unclaimedAtEpoch(_loadContextForRead(account), account);
    }

    /**
     * @notice Converts a given amount of assets to shares
     * @param assets Number of assets to convert to shares
     * @return Amount of shares for the given assets
     */
    function convertToShares(UFixed18 assets) external view returns (UFixed18) {
        Context memory context = _loadContextForRead(address(0));
        (context.latestAssets, context.latestShares) =
            (_totalAssetsAtEpoch(context), _totalSupplyAtEpoch(context));
        return _convertToSharesAtEpoch(context.latestAssets, context.latestShares, assets);
    }

    /**
     * @notice Converts a given amount of shares to assets
     * @param shares Number of shares to convert to assets
     * @return Amount of assets for the given shares
     */
    function convertToAssets(UFixed18 shares) external view returns (UFixed18) {
        Context memory context = _loadContextForRead(address(0));
        (context.latestAssets, context.latestShares) =
            (_totalAssetsAtEpoch(context), _totalSupplyAtEpoch(context));
        return _convertToAssetsAtEpoch(context.latestAssets, context.latestShares, shares);
    }

    /**
     * @notice Returns the current epoch
     * @return The current epoch
     */
    function currentEpoch() external view returns (uint256) {
        return _currentEpoch(_loadContextForRead(address(0)));
    }

    /**
     * @notice Returns the current epoch
     * @return The current epoch
     */
    function _currentEpoch(Context memory context) private view returns (uint256) {
        return _currentEpochComplete(context) ? _delta.epoch + 1 : _delta.epoch;
    }

    /**
     * @notice Returns the whether the current epoch is currently complete
     * @dev An epoch is "complete" when all of the underlying oracles have advanced a version
     * @return Whether the current epoch is complete
     */
    function _currentEpochComplete(Context memory context) private view returns (bool) {
        for (uint256 marketId; marketId < totalMarkets; marketId++) {
            if (context.markets[marketId].latestVersion == _versionAtEpoch(marketId, _delta.epoch)) return false;
        }
        return true;
    }

    /**
     * @notice Returns the whether the current epoch is currently stale
     * @dev An epoch is "stale" when any one of the underlying oracles have advanced a version
     * @return Whether the current epoch is stale
     */
    function _currentEpochStale(Context memory context) private view returns (bool) {
        for (uint256 marketId; marketId < totalMarkets; marketId++) {
            if (context.markets[marketId].latestVersion > _versionAtEpoch(marketId, _delta.epoch)) return true;
        }
        return false;
    }

    /**
     * @notice Hook that is called before every stateful operation
     * @dev Settles the vault's account on both the long and short product, along with any global or user-specific deposits/redemptions
     * @param account The account that called the operation, or 0 if called by a keeper.
     * @return context The current epoch contexts for each market
     */
    function _settle(address account) private returns (Context memory context) {
        context = _loadContextForWrite(account);


        if (context.epoch > _delta.epoch) {
            _totalSupply = _totalSupplyAtEpoch(context).sub(_pendingDelta.redemption); // TODO: clean that up
            _totalUnclaimed = _totalUnclaimedAtEpoch(context);
            _delta.clear(context.epoch);

            for (uint256 marketId; marketId < totalMarkets; marketId++) {
                _marketAccounts[marketId].epochs[context.epoch] = MarketEpoch(
                    context.markets[marketId].latestPositionAccount,
                    context.markets[marketId].collateral
                );
                _marketAccounts[marketId].versionOf[context.epoch] = context.markets[marketId].latestVersion;
            }
            _epochs[context.epoch].totalShares = _totalSupplyAtEpoch(context);
            _epochs[context.epoch].totalAssets = _totalAssetsAtEpoch(context);

            // process pending deposit / redemption after new epoch is settled
            _delta.overwrite(_pendingDelta);
            _pendingDelta.clear(context.epoch + 1);
        }


        if (account != address(0)) {
            if (context.epoch > _deltas[account].epoch) {
                _balanceOf[account] = _balanceOfAtEpoch(context, account).sub(_pendingDeltas[account].redemption); // TODO: clean this up
                _unclaimed[account] = _unclaimedAtEpoch(context, account);
                _deltas[account].clear(context.epoch);
            }
            if (context.epoch > _pendingDeltas[account].epoch) {
                _deltas[account].overwrite(_pendingDeltas[account]);
                _pendingDeltas[account].clear(context.epoch);

                context = _settle(account); // run settle again after moving pending deposits and redemptions into current
            }
        }
    }

    /**
     * @notice Rebalances the collateral and position of the vault
     * @dev Rebalance is executed on best-effort, any failing legs of the strategy will not cause a revert
     * @param claimAmount The amount of assets that will be withdrawn from the vault at the end of the operation
     */
    function _rebalance(Context memory context, UFixed18 claimAmount) private {
        UFixed18 assetsInVault = _assets(context).sub(claimAmount);
        UFixed18 minCollateral = _toU18(factory.parameter().minCollateral);

        // Compute available collateral
        UFixed18 collateral = assetsInVault;
        if (collateral.muldiv(minWeight, totalWeight).lt(minCollateral)) collateral = UFixed18Lib.ZERO;

        // Compute available capital
        UFixed18 capital = assetsInVault
            .sub(_totalUnclaimedAtEpoch(context).add(_delta.deposit).add(_pendingDelta.deposit))
            .mul(_totalSupplyAtEpoch(context).unsafeDiv(_totalSupplyAtEpoch(context).add(_delta.redemption)))
            .add(_delta.deposit);
        if (capital.muldiv(minWeight, totalWeight).lt(minCollateral)) capital = UFixed18Lib.ZERO;

        Target[] memory targets = _computeTargets(context, collateral, capital);

        // Remove collateral from markets above target
        for (uint256 marketId; marketId < totalMarkets; marketId++) {
            if (context.markets[marketId].collateral.gt(targets[marketId].targetCollateral))
                _update(context.markets[marketId], markets(marketId).market, targets[marketId]);
        }

        // Deposit collateral to markets below target
        for (uint256 marketId; marketId < totalMarkets; marketId++) {
            if (context.markets[marketId].collateral.lte(targets[marketId].targetCollateral))
                _update(context.markets[marketId], markets(marketId).market, targets[marketId]);
        }
    }

    function _computeTargets(
        Context memory context,
        UFixed18 collateral,
        UFixed18 capital
    ) private view returns (Target[] memory targets) {
        targets = new Target[](totalMarkets);

        for (uint256 marketId; marketId < totalMarkets; marketId++) {
            MarketDefinition memory marketDefinition = markets(marketId);

            UFixed18 marketCapital = capital.muldiv(marketDefinition.weight, totalWeight);
            if (context.markets[marketId].closed) marketCapital = UFixed18Lib.ZERO;

            uint256 version = _versionAtEpoch(marketId, context.epoch);
            OracleVersion memory latestOracleVersion = context.markets[marketId].oracle.at(version);
            context.markets[marketId].payoff.transform(latestOracleVersion);
            UFixed18 currentPrice = _toU18(latestOracleVersion.price.abs());

            targets[marketId].targetCollateral = collateral.muldiv(marketDefinition.weight, totalWeight);
            targets[marketId].targetPosition = _toU6(marketCapital.mul(targetLeverage).div(currentPrice));
        }
    }

    /**
     * @notice Adjusts the position on `market` to `targetPosition`
     * @param market The market to adjust the vault's position on
     * @param target The new state to target
     */
    function _update(MarketContext memory marketContext, IMarket market, Target memory target) private {
        // compute headroom until hitting taker amount
        if (target.targetPosition.lt(marketContext.currentPositionAccount)) {
            UFixed6 makerAvailable = marketContext.currentPosition.maker.gt(marketContext.currentPosition.net()) ?
                marketContext.currentPosition.maker.sub(marketContext.currentPosition.net()) :
                UFixed6Lib.ZERO;
            target.targetPosition = marketContext.currentPositionAccount
                .sub(marketContext.currentPositionAccount.sub(target.targetPosition).min(makerAvailable));
        }

        // compute headroom until hitting makerLimit
        if (target.targetPosition.gt(marketContext.currentPositionAccount)) {
            UFixed6 makerLimit = marketContext.makerLimit;
            UFixed6 makerAvailable = makerLimit.gt(marketContext.currentPosition.maker) ?
                makerLimit.sub(marketContext.currentPosition.maker) :
                UFixed6Lib.ZERO;
            target.targetPosition = marketContext.currentPositionAccount
                .add(target.targetPosition.sub(marketContext.currentPositionAccount).min(makerAvailable));
        }

        // issue position update
        market.update(
            address(this),
            target.targetPosition,
            UFixed6Lib.ZERO,
            UFixed6Lib.ZERO,
            Fixed6Lib.from(_toU6(target.targetCollateral))
        );
    }

    /**
     * @notice Decrements `spender`s allowance for `account` by `amount`
     * @dev Does not decrement if approval is for -1
     * @param account Address of allower
     * @param spender Address of spender
     * @param amount Amount to decrease allowance by
     */
    function _consumeAllowance(address account, address spender, UFixed18 amount) private {
        if (allowance[account][spender].eq(UFixed18Lib.MAX)) return;
        allowance[account][spender] = allowance[account][spender].sub(amount);
    }

    /**
     * @notice Loads the context for the given `account`, settling the vault first
     * @param account Account to load the context for
     * @return Epoch context
     */
    function _loadContextForWrite(address account) private returns (Context memory) {
        for (uint256 marketId; marketId < totalMarkets; marketId++) {
            markets(marketId).market.settle(address(this));
        }

        return _loadContextForRead(account);
    }

    /**
     * @notice Loads the context for the given `account`
     * @param account Account to load the context for
     * @return context Epoch context
     */
    function _loadContextForRead(address account) private view returns (Context memory context) {
        context.latestAssets = _assetsAtEpoch(_delta.epoch);
        context.latestShares = _sharesAtEpoch(_delta.epoch);
        context.latestAssetsAccount = _assetsAtEpoch(_deltas[account].epoch);
        context.latestSharesAccount = _sharesAtEpoch(_deltas[account].epoch);

        context.markets = new MarketContext[](totalMarkets);
        for (uint256 marketId; marketId < totalMarkets; marketId++) {
            MarketDefinition memory marketDefinition = markets(marketId);
            MarketParameter memory marketParameter = marketDefinition.market.parameter();
            context.markets[marketId].closed = marketParameter.closed;
            context.markets[marketId].makerLimit = marketParameter.makerLimit;
            context.markets[marketId].oracle = marketParameter.oracle;
            context.markets[marketId].payoff = marketParameter.payoff;

            // global
            Global memory global = marketDefinition.market.global();
            Position memory currentPosition = marketDefinition.market.pendingPosition(global.currentId);
            Position memory latestPosition = marketDefinition.market.position();

            context.markets[marketId].latestVersion = latestPosition.version;
            context.markets[marketId].currentPosition = currentPosition;

            // local
            Local memory local = marketDefinition.market.locals(address(this));
            currentPosition = marketDefinition.market.pendingPositions(address(this), local.currentId);
            latestPosition = marketDefinition.market.positions(address(this));

            context.markets[marketId].latestVersionAccount = latestPosition.version;
            context.markets[marketId].latestPositionAccount = latestPosition.maker;
            context.markets[marketId].currentPositionAccount = currentPosition.maker;
            context.markets[marketId].collateral = _toU18(local.collateral.max(Fixed6Lib.ZERO).abs());
            context.markets[marketId].liquidation = local.liquidation;
        }

        context.epoch = _currentEpoch(context);
    }

    /**
     * @notice Calculates whether or not the vault is in an unhealthy state at the provided epoch
     * @param context Epoch context to calculate health
     * @return bool true if unhealthy, false if healthy
     */
    function _unhealthyAtEpoch(Context memory context) private view returns (bool) {
        if (!context.latestShares.isZero() && context.latestAssets.isZero()) return true;
        for (uint256 marketId; marketId < totalMarkets; marketId++) {
            if (_unhealthy(context.markets[marketId])) return true;
        }
        return false;
    }

    /**
     * @notice Determines whether the market pair is currently in an unhealthy state
     * @dev market is unhealthy if either the long or short markets are liquidating or liquidatable
     * @param marketContext The configuration of the market
     * @return bool true if unhealthy, false if healthy
     */
    function _unhealthy(MarketContext memory marketContext) internal pure returns (bool) {
        //TODO: figure out how to compute "can liquidate"
        return /* collateral.liquidatable(address(this), marketDefinition.long) || */ (
            marketContext.liquidation >= marketContext.latestVersionAccount
        );
    }

    /**
     * @notice The maximum available deposit amount at the given epoch
     * @param context Epoch context to use in calculation
     * @return Maximum available deposit amount at epoch
     */
    function _maxDepositAtEpoch(Context memory context) private view returns (UFixed18) {
        if (_unhealthyAtEpoch(context)) return UFixed18Lib.ZERO;
        UFixed18 currentCollateral = _totalAssetsAtEpoch(context).add(_delta.deposit).add(_pendingDelta.deposit);
        return maxCollateral.gt(currentCollateral) ? maxCollateral.sub(currentCollateral) : UFixed18Lib.ZERO;
    }

    /**
     * @notice The maximum available redeemable amount at the given epoch for `account`
     * @param context Epoch context to use in calculation
     * @param account Account to calculate redeemable amount
     * @return Maximum available redeemable amount at epoch
     */
    function _maxRedeemAtEpoch(Context memory context, address account) private view returns (UFixed18) {
        if (_unhealthyAtEpoch(context)) return UFixed18Lib.ZERO;
        return _balanceOfAtEpoch(context, account);
    }

    /**
     * @notice The total assets at the given epoch
     * @param context Epoch context to use in calculation
     * @return Total assets amount at epoch
     */
    function _totalAssetsAtEpoch(Context memory context) private view returns (UFixed18) {
        (UFixed18 totalCollateral, UFixed18 totalDebt) = (
            _assets(context),
            _totalUnclaimedAtEpoch(context).add(_delta.deposit).add(_pendingDelta.deposit)
        );
        return totalCollateral.gt(totalDebt) ? totalCollateral.sub(totalDebt) : UFixed18Lib.ZERO;
    }

    /**
     * @notice The total supply at the given epoch
     * @param context Epoch context to use in calculation
     * @return Total supply amount at epoch
     */
    function _totalSupplyAtEpoch(Context memory context) private view returns (UFixed18) {
        if (context.epoch == _delta.epoch) return _totalSupply.add(_pendingDelta.redemption);
        return _totalSupply.add(_pendingDelta.redemption)
            .add(_convertToSharesAtEpoch(context.latestAssets, context.latestShares, _delta.deposit));
    }

    /**
     * @notice The balance of `account` at the given epoch
     * @param context Account epoch context to use in calculation
     * @param account Account to calculate balance of amount
     * @return Account balance at epoch
     */
    function _balanceOfAtEpoch(Context memory context, address account) private view returns (UFixed18) {
        if (context.epoch == _deltas[account].epoch) return _balanceOf[account].add(_pendingDeltas[account].redemption);
        return _balanceOf[account].add(_pendingDeltas[account].redemption)
            .add(_convertToSharesAtEpoch(context.latestAssetsAccount, context.latestSharesAccount, _deltas[account].deposit));
    }

    /**
     * @notice The total unclaimed assets at the given epoch
     * @param context Epoch context to use in calculation
     * @return Total unclaimed asset amount at epoch
     */
    function _totalUnclaimedAtEpoch(Context memory context) private view returns (UFixed18) {
        if (context.epoch == _delta.epoch) return _totalUnclaimed;
        return _totalUnclaimed.add(_convertToAssetsAtEpoch(context.latestAssets, context.latestShares, _delta.redemption));
    }

    /**
     * @notice The total unclaimed assets at the given epoch for `account`
     * @param context Account epoch context to use in calculation
     * @param account Account to calculate unclaimed assets for
     * @return Total unclaimed asset amount for `account` at epoch
     */
    function _unclaimedAtEpoch(Context memory context, address account) private view returns (UFixed18) {
        if (context.epoch == _deltas[account].epoch) return _unclaimed[account];
        return _unclaimed[account]
            .add(_convertToAssetsAtEpoch(context.latestAssetsAccount, context.latestSharesAccount, _deltas[account].redemption));
    }

    /**
     * @notice Returns the amounts of the individual sources of assets in the vault
     * @return value The real amount of collateral in the vault
     **/
    function _assets(Context memory context) public view returns (UFixed18 value) {
        value = asset.balanceOf();
        for (uint256 marketId; marketId < totalMarkets; marketId++)
            value = value.add(context.markets[marketId].collateral);
    }

    /**
     * @notice Converts a given amount of assets to shares at epoch
     * @param assets Number of assets to convert to shares
     * @return Amount of shares for the given assets at epoch
     */
    function _convertToSharesAtEpoch(UFixed18 latestAssets, UFixed18 latestShares, UFixed18 assets) private pure returns (UFixed18) {
        if (latestAssets.isZero()) return assets;
        return assets.muldiv(latestShares, latestAssets);
    }

    /**
     * @notice Converts a given amount of shares to assets at epoch
     * @param shares Number of shares to convert to shares
     * @return Amount of assets for the given shares at epoch
     */
    function _convertToAssetsAtEpoch(UFixed18 latestAssets, UFixed18 latestShares, UFixed18 shares) private pure returns (UFixed18) {
        if (latestShares.isZero()) return shares;
        return shares.muldiv(latestAssets, latestShares);
    }

    /**
     * @notice The total assets at the given epoch
     * @dev Calculates and adds accumulated PnL for `version` + 1
     * @param epoch Epoch to get total assets at
     * @return assets Total assets in the vault at the given epoch
     */
    function _assetsAtEpoch(uint256 epoch) private view returns (UFixed18) {
        Fixed18 assets = Fixed18Lib.from(_epochs[epoch].totalAssets);
        for (uint256 marketId; marketId < totalMarkets; marketId++) {
            assets = assets.add(_accumulatedAtEpoch(marketId, epoch));
        }

        // collateral can't go negative within the vault, socializes into unclaimed if triggered
        return UFixed18Lib.from(assets.max(Fixed18Lib.ZERO)); // TODO: does this this work this way?
    }

    /**
     * @notice The total shares at the given epoch
     * @param epoch Epoch to get total shares at
     * @return Total shares at `epoch`
     */
    function _sharesAtEpoch(uint256 epoch) private view returns (UFixed18) {
        return _epochs[epoch].totalShares;
    }

    /**
     * @notice The total assets accumulated at the given epoch for a market pair
     * @dev Calculates accumulated PnL for `version` to `version + 1`
     * @param marketId The market ID to accumulate for
     * @param epoch Epoch to get total assets at
     * @return accumulated Total assets accumulated
     */
    function _accumulatedAtEpoch(uint256 marketId, uint256 epoch) private view returns (Fixed18 accumulated) {
        MarketEpoch memory marketEpoch = _marketAccounts[marketId].epochs[epoch];
        uint256 version = _versionAtEpoch(marketId, epoch);

        // accumulate value from version n + 1
        // TODO: we're not doing n + 1 anymore
        accumulated = _toS18(
            markets(marketId).market.versions(version + 1).makerValue._value // TODO: use accumulator?
                .sub(markets(marketId).market.versions(version).makerValue._value)
                .mul(Fixed6Lib.from(marketEpoch.position))
        );

        // collateral can't go negative on a product
        accumulated = accumulated.max(Fixed18Lib.from(marketEpoch.assets).mul(Fixed18Lib.NEG_ONE)); // TODO: does this this work this way?
    }

    /**
     * @notice Finds the version of a market and a specific epoch
     * @dev This latest implementation of the BalanceVault introduces the concept of "epochs" to enable
     *      multi-payoff vaults. In order to maintain upgrade compatibility with previous version-based instances,
     *      we maintain the invariant that version == epoch prior to the upgrade switchover.
     * @param marketId The market ID to accumulate for
     * @param epoch Epoch to get total assets at
     * @return The version at epoch
     */
    function _versionAtEpoch(uint256 marketId, uint256 epoch) private view returns (uint256) { // TODO: remove
        if (epoch > _delta.epoch) return 0;
        uint256 version = _marketAccounts[marketId].versionOf[epoch];
        return (version == 0) ? epoch : version;
    }

    //TODO: replace these with root functions
    function _toU18(UFixed6 n) private pure returns (UFixed18) {
        return UFixed18.wrap(UFixed6.unwrap(n) * 1e12);
    }

    function _toU6(UFixed18 n) private pure returns (UFixed6) {
        return UFixed6.wrap(UFixed18.unwrap(n) / 1e12);
    }

    function _toS18(Fixed6 n) private pure returns (Fixed18) {
        return Fixed18.wrap(Fixed6.unwrap(n) * 1e12);
    }

    function _toS6(Fixed18 n) private pure returns (Fixed6) {
        return Fixed6.wrap(Fixed18.unwrap(n) / 1e12);
    }
}
