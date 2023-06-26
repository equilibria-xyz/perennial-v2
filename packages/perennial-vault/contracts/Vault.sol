//SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "./interfaces/IVault.sol";
import "@equilibria/root/control/unstructured/UInitializable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./interfaces/IVaultFactory.sol";
import "./types/Account.sol";
import "./types/Checkpoint.sol";
import "./types/Registration.sol";
import "./types/VaultParameter.sol";

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
    IVaultFactory public immutable factory;

    string private _name;

    string private _symbol;

    VaultParameterStorage private _parameter;

    uint256 public totalMarkets;
    
    mapping(uint256 => RegistrationStorage) private _registrations;

    /// @dev Mapping of allowance across all users
    mapping(address => mapping(address => UFixed6)) public allowance;

    /// @dev Global accounting state variables
    AccountStorage private _account;

    /// @dev Per-account accounting state variables
    mapping(address account => AccountStorage) private _accounts;

    /// @dev Per-id accounting state variables
    mapping(uint256 id => CheckpointStorage) private _checkpoints;

    constructor(IVaultFactory factory_) {
        factory = factory_;
    }

    function parameter() external view returns (VaultParameter memory) {
        return _parameter.read();
    }

    function registrations(uint256 marketId) external view returns (Registration memory) {
        return _registrations[marketId].read();
    }

    function name() external view returns (string memory) {
        return string(abi.encodePacked("Perennial V2 Vault: ", _name));
    }

    function symbol() external view returns (string memory) {
        return string(abi.encodePacked("PV-", _symbol));
    }

    function decimals() external view returns (uint8) { return 18; }
    function asset() external view returns (Token18) { return _parameter.read().asset; }
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
        return _totalShares.isZero() ? assets : assets.muldiv(_totalShares, _totalAssets);
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

    function initialize(
        Token18 asset_,
        IMarket initialMarket,
        string calldata name_,
        string calldata symbol_
    ) external initializer(1) {
        _name = name_;
        _symbol = symbol_;
        _parameter.store(VaultParameter(asset_, UFixed6Lib.ZERO, UFixed6Lib.ZERO, UFixed6Lib.ZERO));
        _register(initialMarket, 0);
    }

    function register(IMarket market) external onlyOwner {
        Context memory context = _settle(address(0));

        for (uint256 marketId; marketId < context.markets.length; marketId++) {
            if (_registrations[marketId].read().market == market) revert VaultMarketExistsError();
        }

        _register(market, context.currentId - 1);
    }

    function _register(IMarket market, uint256 initialId) private {
        VaultParameter memory vaultParameter = _parameter.read();

        if (!factory.factory().markets(market)) revert VaultNotMarketError();
        if (!market.token().eq(vaultParameter.asset)) revert VaultIncorrectAssetError();

        vaultParameter.asset.approve(address(market));

        uint256 newMarketId = totalMarkets++;
        _registrations[newMarketId].store(Registration(market, initialId, 0));

        emit MarketRegistered(newMarketId, market);
    }

    function updateWeight(uint256 marketId, uint256 newWeight) external onlyOwner {
        Context memory context = _settle(address(0));

        if (marketId >= context.markets.length) revert VaultMarketDoesNotExistError();

        Registration memory registration = _registrations[marketId].read();
        registration.weight = newWeight;
        _registrations[marketId].store(registration);

        emit WeightUpdated(marketId, newWeight);
    }

    function updateParameter(VaultParameter memory newParameter) external onlyOwner {
        _settle(address(0));
        _parameter.store(newParameter);
        emit ParameterUpdated(newParameter);
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
     * @dev Accounts for makerFee by burning then airdropping makerFee * premium percent of the deposit
     * @param assets The amount of assets to deposit
     * @param account The account to deposit on behalf of
     */
    function deposit(UFixed6 assets, address account) external {
        Context memory context = _settle(account);

        if (assets.gt(_maxDeposit(context))) revert VaultDepositLimitExceededError();
        if (context.latestId < context.local.latest) revert VaultExistingOrderError();

        UFixed6 depositAmount = assets
            .sub(assets.mul(context.makerFee.mul(UFixed6Lib.ONE.add(context.parameter.premium))));

        context.global.deposit =  context.global.deposit.add(depositAmount);
        context.local.latest = context.currentId;
        context.local.deposit = depositAmount;
        context.checkpoint.deposit = context.checkpoint.deposit.add(depositAmount);

        context.parameter.asset.pull(msg.sender, UFixed18Lib.from(assets));

        _rebalance(context, UFixed6Lib.ZERO);
        _saveContext(context, account);

        emit Deposit(msg.sender, account, context.currentId, assets);
    }

    /**
     * @notice Redeems `shares` shares from the vault
     * @dev Accounts for makerFee by burning then airdropping makerFee * premium percent of the redemption
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

        UFixed6 redemptionAmount = shares
            .sub(shares.mul(context.makerFee.mul(UFixed6Lib.ONE.add(context.parameter.premium))));

        context.global.redemption =  context.global.redemption.add(redemptionAmount);
        context.local.latest = context.currentId;
        context.local.redemption = redemptionAmount;
        context.checkpoint.redemption = context.checkpoint.redemption.add(redemptionAmount);

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

        context.parameter.asset.push(account, UFixed18Lib.from(claimAmount));
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

    function transfer(address to, UFixed6 amount) external returns (bool) {
        revert VaultNonTransferableError();
    }

    function transferFrom(address from, address to, UFixed6 amount) external returns (bool) {
        revert VaultNonTransferableError();
    }

    /**
     * @notice The maximum available deposit amount
     * @dev Only exact when vault is synced, otherwise approximate
     * @return Maximum available deposit amount
     */
    function maxDeposit(address) external view returns (UFixed6) {
        return _maxDeposit(_loadContext(address(0)));
    }

    /**
     * @notice The maximum available redeemable amount
     * @dev Only exact when vault is synced, otherwise approximate
     * @param account The account to redeem for
     * @return Maximum available redeemable amount
     */
    function maxRedeem(address account) external view returns (UFixed6) {
        return _maxRedeem(_loadContext(account), account);
    }

    /**
     * @notice Hook that is called before every stateful operation
     * @dev Settles the vault's account on both the long and short product, along with any global or user-specific deposits/redemptions
     * @param account The account that called the operation, or 0 if called by a keeper.
     * @return context The current epoch contexts for each market
     */
    function _settle(address account) private returns (Context memory context) {
        for (uint256 marketId; marketId < totalMarkets; marketId++)
            _registrations[marketId].read().market.settle(address(this));

        context = _loadContext(account);

        // process pending deltas
        while (context.latestId > context.global.latest) {
            uint256 processId = context.global.latest + 1;
            Checkpoint memory checkpoint = _checkpoints[processId].read();
            checkpoint.complete(_collateralAtId(context, processId));
            _checkpoints[processId].store(checkpoint);
            context.global.process(checkpoint, checkpoint.deposit, checkpoint.redemption, processId);
        }
        if (context.latestId >= context.local.latest) {
            Checkpoint memory checkpoint = _checkpoints[context.local.latest].read();
            context.local.process(checkpoint, context.local.deposit, context.local.redemption, context.local.latest);
        }

        // sync data for new id
        context.checkpoint.start(context.global, context.parameter.asset.balanceOf());
    }

    /**
     * @notice Rebalances the collateral and position of the vault
     * @dev Rebalance is executed on best-effort, any failing legs of the strategy will not cause a revert
     * @param claimAmount The amount of assets that will be withdrawn from the vault at the end of the operation
     */
    function _rebalance(Context memory context, UFixed6 claimAmount) private {
        Fixed6 collateralInVault = _collateral(context).sub(Fixed6Lib.from(claimAmount));
        UFixed6 minCollateral = factory.factory().parameter().minCollateral;

        // if negative assets, skip rebalance
        if (collateralInVault.lt(Fixed6Lib.ZERO)) return;

        // Compute available collateral
        UFixed6 collateral = UFixed6Lib.from(collateralInVault);
        if (collateral.muldiv(context.minWeight, context.totalWeight).lt(minCollateral))
            collateral = UFixed6Lib.ZERO;

        // Compute available assets
        UFixed6 assets = UFixed6Lib.from(
                collateralInVault
                    .sub(Fixed6Lib.from(context.global.assets.add(context.global.deposit)))
                    .max(Fixed6Lib.ZERO)
            )
            .mul(context.global.shares.unsafeDiv(context.global.shares.add(context.global.redemption)))
            .add(context.global.deposit);
        if (assets.muldiv(context.minWeight, context.totalWeight).lt(minCollateral))
            assets = UFixed6Lib.ZERO;

        Target[] memory targets = _computeTargets(context, collateral, assets);
        for (uint256 marketId; marketId < context.markets.length; marketId++)
            if (targets[marketId].collateral.lt(Fixed6Lib.ZERO)) _update(context.markets[marketId], targets[marketId]);
        for (uint256 marketId; marketId < context.markets.length; marketId++)
            if (targets[marketId].collateral.gte(Fixed6Lib.ZERO)) _update(context.markets[marketId], targets[marketId]);
    }

    function _computeTargets(
        Context memory context,
        UFixed6 collateral,
        UFixed6 assets
    ) private pure returns (Target[] memory targets) {
        targets = new Target[](context.markets.length);

        for (uint256 marketId; marketId < context.markets.length; marketId++) {
            UFixed6 marketAssets = assets.muldiv(context.markets[marketId].registration.weight, context.totalWeight);
            if (context.markets[marketId].closed) marketAssets = UFixed6Lib.ZERO;

            Fixed6 targetCollateral =
                Fixed6Lib.from(collateral.muldiv(context.markets[marketId].registration.weight, context.totalWeight));
            targets[marketId].collateral = targetCollateral.sub(context.markets[marketId].collateral);
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
        marketContext.registration.market.update(
            address(this),
            target.position,
            UFixed6Lib.ZERO,
            UFixed6Lib.ZERO,
            target.collateral
        );
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
     * @notice Loads the context for the given `account`
     * @param account Account to load the context for
     * @return context Epoch context
     */
    function _loadContext(address account) private view returns (Context memory context) {
        context.parameter = _parameter.read();

        context.latestId = type(uint256).max;
        context.latestTimestamp = type(uint256).max;
        context.minWeight = type(uint256).max;

        context.markets = new MarketContext[](totalMarkets);

        for (uint256 marketId; marketId < context.markets.length; marketId++) {
            Registration memory registration = _registrations[marketId].read();
            MarketParameter memory marketParameter = registration.market.parameter();
            uint256 currentTimestamp = marketParameter.oracle.current();

            context.markets[marketId].registration = registration;
            context.markets[marketId].closed = marketParameter.closed;
            context.markets[marketId].makerLimit = marketParameter.makerLimit;

            // global
            Global memory global = registration.market.global();
            Position memory currentPosition = registration.market.pendingPosition(global.currentId);
            Position memory latestPosition = registration.market.position();
            OracleVersion memory latestOracleVersion = registration.market.at(latestPosition.timestamp);

            context.markets[marketId].price = latestOracleVersion.price.abs();
            context.markets[marketId].currentPosition = currentPosition.maker;
            context.markets[marketId].currentNet = currentPosition.net();
            if (latestPosition.timestamp < context.latestTimestamp) {
                context.latestId = latestPosition.id;
                context.latestTimestamp = latestPosition.timestamp;
            }
            context.makerFee = context.makerFee
                .add(marketParameter.makerFee.mul(context.parameter.leverage).mul(UFixed6Lib.from(registration.weight)));
            context.totalWeight += registration.weight;
            if (registration.weight < context.minWeight) context.minWeight = registration.weight;

            // local
            Local memory local = registration.market.locals(address(this));
            currentPosition = registration.market.pendingPositions(address(this), local.currentId);

            context.markets[marketId].currentPositionAccount = currentPosition.maker;
            context.markets[marketId].collateral = local.collateral;

            if (local.liquidation > context.liquidation) context.liquidation = local.liquidation;
            if (marketId == 0) context.currentId = currentTimestamp > currentPosition.timestamp ? local.currentId + 1 : local.currentId;
        }

        if (context.totalWeight != 0) context.makerFee = context.makerFee.div(UFixed6Lib.from(context.totalWeight));

        context.checkpoint = _checkpoints[context.currentId].read();
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
        return checkpoint.unhealthy() || (context.liquidation > context.latestTimestamp);
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
        for (uint256 marketId; marketId < context.markets.length; marketId++) {
            UFixed6 makerAvailable = context.markets[marketId].currentPosition
                .sub(context.markets[marketId].currentNet.min(context.markets[marketId].currentPosition));

            UFixed6 collateral = makerAvailable.muldiv(context.markets[marketId].price, context.parameter.leverage)
                .muldiv(context.totalWeight, context.markets[marketId].registration.weight);

            Checkpoint memory checkpoint = _checkpoints[context.latestId].read();
            redemptionAmount = redemptionAmount.min(checkpoint.toShares(collateral));
        }
    }

    /**
     * @notice Returns the real amount of collateral in the vault
     * @return value The real amount of collateral in the vault
     **/
    function _collateral(Context memory context) public view returns (Fixed6 value) {
        value = Fixed6Lib.from(UFixed6Lib.from(context.parameter.asset.balanceOf()));
        for (uint256 marketId; marketId < context.markets.length; marketId++)
            value = value.add(context.markets[marketId].collateral);
    }

    function _collateralAtId(Context memory context, uint256 id) public view returns (Fixed6 value) {
        for (uint256 marketId; marketId < context.markets.length; marketId++)
            value = value.add(
                context.markets[marketId].registration.market.pendingPositions(
                    address(this),
                    id - context.markets[marketId].registration.initialId
                ).collateral
            );
    }

    modifier onlyOwner {
        if (msg.sender != factory.owner()) revert VaultNotOwnerError();
        _;
    }
}
