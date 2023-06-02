//SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "./interfaces/IVault.sol";
import "@equilibria/root/control/unstructured/UInitializable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./types/Account.sol";
import "./types/Checkpoint.sol";
import "./types/Registration.sol";
import "./types/VaultParameter.sol";

// TODO: only pull out what you can from collateral when really unbalanced
// TODO: make sure maker fees are supported
// TODO: assumes no one can create an order for the vault (check if liquidation / shortfall break this model?
// TODO: add ownable and factory flow
// TODO: lock down params to owner

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
 */
contract Vault is IVault, UInitializable {
    IFactory public factory;

    /// @dev The underlying asset of the vault
    Token18 public immutable asset;

    VaultParameterStorage private _parameters;

    mapping(uint256 => RegistrationStorage) private _registrations;

    /// @dev Mapping of allowance across all users
    mapping(address => mapping(address => UFixed6)) public allowance;

    /// @dev Global accounting state variables
    AccountStorage private _account;

    /// @dev Per-account accounting state variables
    mapping(address account => AccountStorage) private _accounts;

    /// @dev Per-id accounting state variables
    mapping(uint256 id => CheckpointStorage) private _checkpoints;

    /**
     * @notice Constructor for VaultDefinition
     * @param factory_ The factory contract
     */
    constructor(IFactory factory_, Token18 asset_) {
        factory = factory_;
        asset = asset_;
    }

    function totalMarkets() external view returns (uint256) { return _parameters.read().totalMarkets; }
    function totalWeight() external view returns (uint256) { return _parameters.read().totalWeight; }
    function minWeight() external view returns (uint256) { return _parameters.read().minWeight; }
    function leverage() external view returns (UFixed6) { return _parameters.read().leverage; }
    function cap() external view returns (UFixed6) { return _parameters.read().cap; }
    function name() external view returns (string memory) { return "Vault-XX"; } // TODO generate
    function totalSupply() external view returns (UFixed6) { return _account.read().shares; }
    function balanceOf(address account) public view returns (UFixed6) { return _accounts[account].read().shares; }
    function totalUnclaimed() external view returns (UFixed6) { return _account.read().assets; }
    function unclaimed(address account) external view returns (UFixed6) { return _accounts[account].read().assets; }

    function totalAssets() public view returns (Fixed6) {
        Checkpoint memory checkpoint = _checkpoints[_account.read().latest].read();
        return checkpoint.assets
            .add(Fixed6Lib.from(checkpoint.deposit))
            .sub(Fixed6Lib.from(checkpoint.toAssets(checkpoint.redemption)));
    }

    function totalShares() public view returns (UFixed6) {
        Checkpoint memory checkpoint = _checkpoints[_account.read().latest].read();
        return checkpoint.shares.sub(checkpoint.redemption).add(checkpoint.toShares(checkpoint.deposit));
    }

    /**
     * @notice Converts a given amount of assets to shares
     * @param assets Number of assets to convert to shares
     * @return Amount of shares for the given assets
     */
    function convertToShares(UFixed6 assets) external view returns (UFixed6) {
        (UFixed6 _totalAssets, UFixed6 _totalShares) =
            (UFixed6Lib.from(totalAssets().max(Fixed6Lib.ZERO)), totalShares());
        return _totalAssets.isZero() ? assets : assets.muldiv(_totalShares, _totalAssets);
    }

    /**
     * @notice Converts a given amount of shares to assets
     * @param shares Number of shares to convert to assets
     * @return Amount of assets for the given shares
     */
    function convertToAssets(UFixed6 shares) external view returns (UFixed6) {
        (UFixed6 _totalAssets, UFixed6 _totalShares) =
            (UFixed6Lib.from(totalAssets().max(Fixed6Lib.ZERO)), totalShares());
        return _totalShares.isZero() ? shares : shares.muldiv(_totalAssets, _totalShares);
    }

    function initialize(IMarket market) external initializer(1) {
        _registrations[0].store(Registration(market, 0, 0));

        VaultParameter memory vaultParameter = _parameters.read();
        vaultParameter.totalMarkets++;
        _parameters.store(vaultParameter);

        asset.approve(address(market));
        emit MarketRegistered(0, market);
    }

    function register(IMarket market) external {
        Context memory context = _settle(address(0)); // TODO: can we get rid of this?

        for (uint256 marketId; marketId < context.parameter.totalMarkets; marketId++) {
            if (_registrations[marketId].read().market == market) revert VaultMarketExistsError();
        }

        // TODO: verify its a market in the factory

        asset.approve(address(market));

        _registrations[context.parameter.totalMarkets].store(Registration(market, context.currentId - 1, 0));
        emit MarketRegistered(context.parameter.totalMarkets, market);

        VaultParameter memory vaultParameter = _parameters.read();
        vaultParameter.totalMarkets++;
        _parameters.store(vaultParameter);
    }

    function updateWeight(uint256 marketId, uint256 newWeight) external {
        VaultParameter memory vaultParameter = _parameters.read();

        if (marketId >= vaultParameter.totalMarkets) revert VaultMarketDoesNotExistError();

        Registration memory registration = _registrations[marketId].read();
        vaultParameter.totalWeight = vaultParameter.totalWeight + newWeight - registration.weight;
        registration.weight = newWeight;
        _updateMinWeight(vaultParameter);
        _registrations[marketId].store(registration);
        _parameters.store(vaultParameter);

        emit WeightUpdated(marketId, newWeight);
    }

    function updateLeverage(UFixed6 newLeverage) external {
        VaultParameter memory vaultParameter = _parameters.read();
        vaultParameter.leverage = newLeverage;
        _parameters.store(vaultParameter);

        emit LeverageUpdated(newLeverage);
    }

    function updateCap(UFixed6 newCap) external {
        VaultParameter memory vaultParameter = _parameters.read();
        vaultParameter.cap = newCap;
        _parameters.store(vaultParameter);

        emit CapUpdated(newCap);
    }

    function _updateMinWeight(VaultParameter memory vaultParameter) private {
        vaultParameter.minWeight = type(uint32).max;
        for (uint256 marketId; marketId < vaultParameter.totalMarkets; marketId++) {
            Registration memory registration = _registrations[marketId].read();
            if (registration.weight > 0 && registration.weight < vaultParameter.minWeight)
                vaultParameter.minWeight = registration.weight;
        }
    }

    /**
     * @notice Syncs `account`'s state up to current
     * @dev Also rebalances the collateral and position of the vault without a deposit or withdraw
     * @param account The account that should be synced
     */
    function settle(address account) public {
        Context memory context = _settle(account);
        _rebalance(context, UFixed6Lib.ZERO);
        _saveContext(context, account);
    }

    /**
     * @notice Deposits `assets` assets into the vault, returning shares to `account` after the deposit settles.
     * @param assets The amount of assets to deposit
     * @param account The account to deposit on behalf of
     */
    function deposit(UFixed6 assets, address account) external {
        Context memory context = _settle(account);

        if (assets.gt(_maxDeposit(context))) revert VaultDepositLimitExceededError();
        if (context.latestId < context.local.latest) revert VaultExistingOrderError();

        context.global.deposit =  context.global.deposit.add(assets);
        context.local.latest = context.currentId;
        context.local.deposit = assets;
        context.checkpoint.deposit = context.checkpoint.deposit.add(assets);

        asset.pull(msg.sender, _toU18(assets));

        _rebalance(context, UFixed6Lib.ZERO);
        _saveContext(context, account);

        emit Deposit(msg.sender, account, context.currentId, assets);
    }

    /**
     * @notice Redeems `shares` shares from the vault
     * @dev Does not return any assets to the user due to delayed settlement. Use `claim` to claim assets
     *      If account is not msg.sender, requires prior spending approval
     * @param shares The amount of shares to redeem
     * @param account The account to redeem on behalf of
     */
    function redeem(UFixed6 shares, address account) external {
        if (msg.sender != account) _consumeAllowance(account, msg.sender, shares);

        Context memory context = _settle(account);
        if (shares.gt(_maxRedeem(context, account))) revert VaultRedemptionLimitExceededError();
        if (context.latestId < context.local.latest) revert VaultExistingOrderError();

        context.global.redemption =  context.global.redemption.add(shares);
        context.local.latest = context.currentId;
        context.local.redemption = shares;
        context.checkpoint.redemption = context.checkpoint.redemption.add(shares);

        context.local.shares = context.local.shares.sub(shares);
        context.global.shares = context.global.shares.sub(shares);

        _rebalance(context, UFixed6Lib.ZERO);
        _saveContext(context, account);

        emit Redemption(msg.sender, account, context.currentId, shares);
    }

    /**
     * @notice Claims all claimable assets for account, sending assets to account
     * @param account The account to claim for
     */
    function claim(address account) external {
        Context memory context = _settle(account);

        UFixed6 unclaimedAmount = context.local.assets;
        UFixed6 unclaimedTotal = context.global.assets;
        context.local.assets = UFixed6Lib.ZERO;
        context.global.assets = unclaimedTotal.sub(unclaimedAmount);
        emit Claim(msg.sender, account, unclaimedAmount);

        // pro-rate if vault has less collateral than unclaimed
        UFixed6 claimAmount = unclaimedAmount;
        UFixed6 totalCollateral = UFixed6Lib.from(_collateral(context).max(Fixed6Lib.ZERO));
        if (totalCollateral.lt(unclaimedTotal))
            claimAmount = claimAmount.muldiv(totalCollateral, unclaimedTotal);

        _rebalance(context, claimAmount);

        _saveContext(context, account);

        asset.push(account, _toU18(claimAmount));
    }

    /**
     * @notice Sets `amount` as the allowance of `spender` over the caller's shares
     * @param spender Address which can spend operate on shares
     * @param amount Amount of shares that spender can operate on
     * @return bool true if the approval was successful, otherwise reverts
     */
    function approve(address spender, UFixed6 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    /**
     * @notice The maximum available deposit amount
     * @dev Only exact when vault is synced, otherwise approximate
     * @return Maximum available deposit amount
     */
    function maxDeposit(address) external view returns (UFixed6) {
        return _maxDeposit(_loadContextForRead(address(0)));
    }

    /**
     * @notice The maximum available redeemable amount
     * @dev Only exact when vault is synced, otherwise approximate
     * @param account The account to redeem for
     * @return Maximum available redeemable amount
     */
    function maxRedeem(address account) external view returns (UFixed6) {
        return _maxRedeem(_loadContextForRead(account), account);
    }

    /**
     * @notice Hook that is called before every stateful operation
     * @dev Settles the vault's account on both the long and short product, along with any global or user-specific deposits/redemptions
     * @param account The account that called the operation, or 0 if called by a keeper.
     * @return context The current epoch contexts for each market
     */
    function _settle(address account) private returns (Context memory context) {
        context = _loadContextForWrite(account);

        // process pending deltas
        while (context.latestId > context.global.latest) {
            Checkpoint memory checkpoint = _checkpoints[context.global.latest + 1].read();
            checkpoint.complete(_collateral(context, context.global.latest + 1));
            _checkpoints[context.global.latest + 1].store(checkpoint);
            context.global.process(checkpoint, checkpoint.deposit, checkpoint.redemption, context.global.latest + 1);
        }
        if (context.latestId >= context.local.latest) {
            Checkpoint memory checkpoint = _checkpoints[context.local.latest].read();
            context.local.process(checkpoint, context.local.deposit, context.local.redemption, context.local.latest);
        }

        // sync data for new id
        context.checkpoint.start(
            context.global.shares,
            Fixed6Lib.from(_toU6(asset.balanceOf()))
                .sub(Fixed6Lib.from(context.global.deposit.add(context.global.assets)))
        );
    }

    /**
     * @notice Rebalances the collateral and position of the vault
     * @dev Rebalance is executed on best-effort, any failing legs of the strategy will not cause a revert
     * @param claimAmount The amount of assets that will be withdrawn from the vault at the end of the operation
     */
    function _rebalance(Context memory context, UFixed6 claimAmount) private {
        Fixed6 collateralInVault = _collateral(context).sub(Fixed6Lib.from(claimAmount));
        UFixed6 minCollateral = factory.parameter().minCollateral;

        // if negative assets, skip rebalance
        if (collateralInVault.lt(Fixed6Lib.ZERO)) return;

        // Compute available collateral
        UFixed6 collateral = UFixed6Lib.from(collateralInVault);
        if (collateral.muldiv(context.parameter.minWeight, context.parameter.totalWeight).lt(minCollateral))
            collateral = UFixed6Lib.ZERO;

        // Compute available assets
        UFixed6 assets = UFixed6Lib.from(
                collateralInVault
                    .sub(Fixed6Lib.from(context.global.assets.add(context.global.deposit)))
                    .max(Fixed6Lib.ZERO)
            )
            .mul(context.global.shares.unsafeDiv(context.global.shares.add(context.global.redemption)))
            .add(context.global.deposit);
        if (assets.muldiv(context.parameter.minWeight, context.parameter.totalWeight).lt(minCollateral))
            assets = UFixed6Lib.ZERO;

        Target[] memory targets = _computeTargets(context, collateral, assets);

        // Remove collateral from markets above target
        for (uint256 marketId; marketId < context.parameter.totalMarkets; marketId++) {
            if (context.markets[marketId].collateral.gt(targets[marketId].collateral))
                _update(context.markets[marketId], targets[marketId]);
        }

        // Deposit collateral to markets below target
        for (uint256 marketId; marketId < context.parameter.totalMarkets; marketId++) {
            if (context.markets[marketId].collateral.lte(targets[marketId].collateral))
                _update(context.markets[marketId], targets[marketId]);
        }
    }

    function _computeTargets(
        Context memory context,
        UFixed6 collateral,
        UFixed6 assets
    ) private view returns (Target[] memory targets) {
        targets = new Target[](context.parameter.totalMarkets);

        for (uint256 marketId; marketId < context.parameter.totalMarkets; marketId++) {
            UFixed6 marketAssets = assets.muldiv(context.markets[marketId].weight, context.parameter.totalWeight);
            if (context.markets[marketId].closed) marketAssets = UFixed6Lib.ZERO;

            targets[marketId].collateral =
                Fixed6Lib.from(collateral.muldiv(context.markets[marketId].weight, context.parameter.totalWeight));
            targets[marketId].position = marketAssets.mul(context.parameter.leverage).div(context.markets[marketId].price);
        }
    }

    /**
     * @notice Adjusts the position on `market` to `targetPosition`
     * @param target The new state to target
     */
    function _update(MarketContext memory marketContext, Target memory target) private {
        // compute headroom until hitting taker amount
        if (target.position.lt(marketContext.currentPositionAccount)) {
            UFixed6 makerAvailable = marketContext.currentPosition
                .sub(marketContext.currentNet.min(marketContext.currentPosition));
            target.position = marketContext.currentPositionAccount
                .sub(marketContext.currentPositionAccount.sub(target.position).min(makerAvailable));
        }

        // compute headroom until hitting makerLimit
        if (target.position.gt(marketContext.currentPositionAccount)) {
            UFixed6 makerAvailable = marketContext.makerLimit
                .sub(marketContext.currentPosition.min(marketContext.makerLimit));
            target.position = marketContext.currentPositionAccount
                .add(target.position.sub(marketContext.currentPositionAccount).min(makerAvailable));
        }

        // issue position update
        marketContext.market.update(address(this), target.position, UFixed6Lib.ZERO, UFixed6Lib.ZERO, target.collateral);
    }

    /**
     * @notice Decrements `spender`s allowance for `account` by `amount`
     * @dev Does not decrement if approval is for -1
     * @param account Address of allower
     * @param spender Address of spender
     * @param amount Amount to decrease allowance by
     */
    function _consumeAllowance(address account, address spender, UFixed6 amount) private {
        if (allowance[account][spender].eq(UFixed6Lib.MAX)) return;
        allowance[account][spender] = allowance[account][spender].sub(amount);
    }

    /**
     * @notice Loads the context for the given `account`, settling the vault first
     * @param account Account to load the context for
     * @return Epoch context
     */
    function _loadContextForWrite(address account) private returns (Context memory) {

        for (uint256 marketId; marketId < _parameters.read().totalMarkets; marketId++) {
            _registrations[marketId].read().market.settle(address(this));
        }

        return _loadContextForRead(account);
    }

    /**
     * @notice Loads the context for the given `account`
     * @param account Account to load the context for
     * @return context Epoch context
     */
    function _loadContextForRead(address account) private view returns (Context memory context) {
        context.parameter = _parameters.read();

        context.latestId = type(uint256).max;
        context.latestVersion = type(uint256).max;
        context.markets = new MarketContext[](context.parameter.totalMarkets);

        for (uint256 marketId; marketId < context.parameter.totalMarkets; marketId++) {
            Registration memory registration = _registrations[marketId].read();
            MarketParameter memory marketParameter = registration.market.parameter();
            uint256 currentVersion = marketParameter.oracle.current();

            context.markets[marketId].market = registration.market;
            context.markets[marketId].weight = registration.weight;
            context.markets[marketId].closed = marketParameter.closed;
            context.markets[marketId].makerLimit = marketParameter.makerLimit;

            // global
            Global memory global = registration.market.global();
            Position memory currentPosition = registration.market.pendingPosition(global.currentId);
            Position memory latestPosition = registration.market.position();
            OracleVersion memory latestOracleVersion = registration.market.at(latestPosition.version);

            context.markets[marketId].price = latestOracleVersion.price.abs();
            context.markets[marketId].currentPosition = currentPosition.maker;
            context.markets[marketId].currentNet = currentPosition.net();
            if (latestPosition.version < context.latestVersion) {
                context.latestId = latestPosition.id;
                context.latestVersion = latestPosition.version;
            }

            // local
            Local memory local = registration.market.locals(address(this));
            currentPosition = registration.market.pendingPositions(address(this), local.currentId);

            context.markets[marketId].currentPositionAccount = currentPosition.maker;
            context.markets[marketId].collateral = local.collateral;

            if (local.liquidation > context.liquidation) context.liquidation = local.liquidation;
            if (marketId == 0) context.currentId = currentVersion > currentPosition.version ? local.currentId + 1 : local.currentId;
        }

        context.checkpoint = _checkpoints[context.currentId].read(); //TODO: latest checkpoint
        context.global = _account.read();
        context.local = _accounts[account].read();
    }

    function _saveContext(Context memory context, address account) private {
        _checkpoints[context.currentId].store(context.checkpoint);
        _account.store(context.global);
        _accounts[account].store(context.local);
    }

    /**
     * @notice Calculates whether or not the vault is in an unhealthy state at the provided epoch
     * @param context Epoch context to calculate health
     * @return bool true if unhealthy, false if healthy
     */
    function _unhealthy(Context memory context) private view returns (bool) {
        Checkpoint memory checkpoint = _checkpoints[context.latestId].read(); // latest basis will always be complete
        return checkpoint.unhealthy() || (context.liquidation > context.latestVersion);
    }

    /**
     * @notice The maximum available deposit amount at the given epoch
     * @param context Epoch context to use in calculation
     * @return Maximum available deposit amount at epoch
     */
    function _maxDeposit(Context memory context) private view returns (UFixed6) {
        if (_unhealthy(context)) return UFixed6Lib.ZERO;
        UFixed6 collateral = UFixed6Lib.from(totalAssets().max(Fixed6Lib.ZERO)).add(_account.read().deposit);
        return context.global.assets.add(context.parameter.cap.sub(collateral.min(context.parameter.cap)));
    }

    /**
     * @notice The maximum available redeemable amount at the given epoch for `account`
     * @param context Epoch context to use in calculation
     * @param account Account to calculate redeemable amount
     * @return redemptionAmount Maximum available redeemable amount at epoch
     */
    function _maxRedeem(Context memory context, address account) private view returns (UFixed6 redemptionAmount) {
        if (_unhealthy(context)) return UFixed6Lib.ZERO;

        redemptionAmount = balanceOf(account);
        for (uint256 marketId; marketId < context.parameter.totalMarkets; marketId++) {
            UFixed6 makerAvailable = context.markets[marketId].currentPosition
                .sub(context.markets[marketId].currentNet.min(context.markets[marketId].currentPosition));

            UFixed6 collateral = makerAvailable.muldiv(context.markets[marketId].price, context.parameter.leverage)
                .muldiv(context.parameter.totalWeight, context.markets[marketId].weight);

            Checkpoint memory checkpoint = _checkpoints[context.latestId].read();
            redemptionAmount = redemptionAmount.min(checkpoint.toShares(collateral));
        }
    }

    /**
     * @notice Returns the real amount of collateral in the vault
     * @return value The real amount of collateral in the vault
     **/
    function _collateral(Context memory context) public view returns (Fixed6 value) {
        value = Fixed6Lib.from(_toU6(asset.balanceOf()));
        for (uint256 marketId; marketId < context.parameter.totalMarkets; marketId++)
            value = value.add(context.markets[marketId].collateral);
    }

    function _collateral(Context memory context, uint256 id) public view returns (Fixed6 value) {
        for (uint256 marketId; marketId < context.parameter.totalMarkets; marketId++)
            value = value.add(
                _registrations[marketId].read().market
                    .pendingPositions(address(this), id - _registrations[marketId].read().initialId).collateral
            );
        // TODO: should this cap the assets at 0?
    }

    //TODO: replace these with root functions
    function _toU18(UFixed6 n) private pure returns (UFixed18) {
        return UFixed18.wrap(UFixed6.unwrap(n) * 1e12);
    }

    function _toU6(UFixed18 n) private pure returns (UFixed6) {
        return UFixed6.wrap(UFixed18.unwrap(n) / 1e12);
    }
}
