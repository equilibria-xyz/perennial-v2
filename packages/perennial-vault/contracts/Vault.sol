//SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "@equilibria/root-v2/contracts/Instance.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./interfaces/IVaultFactory.sol";
import "./types/Account.sol";
import "./types/Checkpoint.sol";
import "./types/Registration.sol";
import "./types/VaultParameter.sol";
import "./interfaces/IVault.sol";

// TODO: can we use the pendingPosition state to compute the makerFee?

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
contract Vault is IVault, Instance {
    string private _name;

    string private _symbol;

    Token18 public asset;

    VaultParameterStorage private _parameter;

    uint256 public totalMarkets;
    
    mapping(uint256 => RegistrationStorage) private _registrations;

    /// @dev Mapping of allowance across all users
    mapping(address => mapping(address => UFixed6)) public allowance; // TODO: operator model

    /// @dev Per-account accounting state variables
    mapping(address account => AccountStorage) private _accounts;

    /// @dev Per-id accounting state variables
    mapping(uint256 id => CheckpointStorage) private _checkpoints;

    function initialize(
        Token18 asset_,
        IMarket initialMarket,
        string calldata name_,
        string calldata symbol_
    ) external initializer(1) {
        __Instance__initialize();

        asset = asset_;
        _name = name_;
        _symbol = symbol_;
        _register(initialMarket, 0);
    }

    function parameter() external view returns (VaultParameter memory) {
        return _parameter.read();
    }

    function registrations(uint256 marketId) external view returns (Registration memory) {
        return _registrations[marketId].read();
    }

    function accounts(address account) external view returns (Account memory) {
        return _accounts[account].read();
    }

    function name() external view returns (string memory) {
        return string(abi.encodePacked("Perennial V2 Vault: ", _name));
    }

    function symbol() external view returns (string memory) {
        return string(abi.encodePacked("PV-", _symbol));
    }

    function decimals() external pure returns (uint8) { return 18; }
    function totalSupply() external view returns (UFixed6) { return _accounts[address(0)].read().shares; }
    function balanceOf(address account) public view returns (UFixed6) { return _accounts[account].read().shares; }
    function totalUnclaimed() external view returns (UFixed6) { return _accounts[address(0)].read().assets; }
    function unclaimed(address account) external view returns (UFixed6) { return _accounts[account].read().assets; }

    function totalAssets() public view returns (Fixed6) {
        Checkpoint memory checkpoint = _checkpoints[_accounts[address(0)].read().latest].read();
        return checkpoint.assets
            .add(Fixed6Lib.from(checkpoint.deposit))
            .sub(Fixed6Lib.from(checkpoint.toAssets(checkpoint.redemption)));
    }

    function totalShares() public view returns (UFixed6) {
        Checkpoint memory checkpoint = _checkpoints[_accounts[address(0)].read().latest].read();
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

    function register(IMarket market) external onlyOwner {
        _settleUnderlying();
        Context memory context = _loadContext(address(0));
        _settle(context);

        for (uint256 marketId; marketId < context.markets.length; marketId++) {
            if (_registrations[marketId].read().market == market) revert VaultMarketExistsError();
        }

        _register(market, context.currentId - 1);
        _saveContext(context, address(0));
    }

    function _register(IMarket market, uint256 initialId) private {
        if (!IVaultFactory(address(factory())).marketFactory().instances(market)) revert VaultNotMarketError();
        if (!market.token().eq(asset)) revert VaultIncorrectAssetError();

        asset.approve(address(market));

        uint256 newMarketId = totalMarkets++;
        _registrations[newMarketId].store(Registration(market, initialId, 0));

        emit MarketRegistered(newMarketId, market);
    }

    function updateWeight(uint256 marketId, uint256 newWeight) external onlyOwner {
        _settleUnderlying();
        Context memory context = _loadContext(address(0));
        _settle(context);

        if (marketId >= context.markets.length) revert VaultMarketDoesNotExistError();

        Registration memory registration = _registrations[marketId].read();
        registration.weight = newWeight;
        _registrations[marketId].store(registration);
        _saveContext(context, address(0));
        emit WeightUpdated(marketId, newWeight);
    }

    function updateParameter(VaultParameter memory newParameter) external onlyOwner {
        settle(address(0));

        _parameter.store(newParameter);
        emit ParameterUpdated(newParameter);
    }

    /**
     * @notice Syncs `account`'s state up to current
     * @dev Also rebalances the collateral and position of the vault without a deposit or withdraw
     * @param account The account that should be synced
     */
    function settle(address account) public whenNotPaused {
        _settleUnderlying();
        Context memory context = _loadContext(account);

        _settle(context);
        _manage(context, UFixed6Lib.ZERO, false); // TODO: support non-zero claim
        _saveContext(context, account);
    }

    function _fee(Context memory context) private view returns (
        UFixed6 makerFee,
        UFixed6 settlementFeeAssets,
        UFixed6 settlementFeeShares
    ) {
        UFixed6 premiumMultiplier = UFixed6Lib.ONE.add(context.parameter.premium);

        makerFee = context.makerFee.mul(premiumMultiplier); // TODO: include skew and impact
        settlementFeeAssets = context.settlementFee;
        settlementFeeShares = context.latestCheckpoint.toShares(settlementFeeAssets.mul(premiumMultiplier));
    }

    function _socialize(Context memory context, UFixed6 claimAssets) private view returns (UFixed6) {
        if (context.global.assets.isZero()) return UFixed6Lib.ZERO;
        UFixed6 totalCollateral = UFixed6Lib.from(_collateral(context).max(Fixed6Lib.ZERO));
        return claimAssets.muldiv(totalCollateral.min(context.global.assets), context.global.assets);
    }

    /**
     * @notice Sets `amount` as the allowance of `spender` over the caller's shares
     * @param spender Address which can spend operate on shares
     * @param amount Amount of shares that spender can operate on
     * @return bool true if the approval was successful, otherwise reverts
     */
    function approve(address spender, UFixed6 amount) external whenNotPaused returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address, UFixed6) external pure returns (bool) { revert VaultNonTransferableError(); }
    function transferFrom(address, address, UFixed6) external pure returns (bool) { revert VaultNonTransferableError(); }

    /// @notice Updates `account`, depositing `depositAssets` assets, redeeming `redeemShares` shares, and claiming `claimAssets` assets
    /// @param account The account to operate on
    /// @param depositAssets The amount of assets to deposit
    /// @param redeemShares The amount of shares to redeem
    /// @param claimAssets The amount of assets to claim
    function update(
        address account,
        UFixed6 depositAssets,
        UFixed6 redeemShares,
        UFixed6 claimAssets
    ) external whenNotPaused {
        _settleUnderlying();
        Context memory context = _loadContext(account);

        _settle(context);
        _update(context, account, depositAssets, redeemShares, claimAssets);
        _saveContext(context, account);
    }

    function _update(
        Context memory context,
        address account,
        UFixed6 depositAssets,
        UFixed6 redeemShares,
        UFixed6 claimAssets
    ) private {
        // TODO: move to invariant
        if (msg.sender != account) _consumeAllowance(account, msg.sender, redeemShares);
        if (depositAssets.gt(_maxDeposit(context))) revert VaultDepositLimitExceededError();
        if (redeemShares.gt(_maxRedeem(context))) revert VaultRedemptionLimitExceededError();
        if (context.latestId < context.local.latest) revert VaultExistingOrderError();

        // magic values
        if (claimAssets.eq(UFixed6Lib.MAX)) claimAssets = context.local.assets;

        // TODO: single sided
        (UFixed6 makerFee, UFixed6 settlementFeeAssets, UFixed6 settlementFeeShares) = _fee(context);
        UFixed6 depositAmount = depositAssets.sub(depositAssets.mul(makerFee).add(settlementFeeAssets));
        UFixed6 redemptionAmount = redeemShares.sub(redeemShares.mul(makerFee).add(settlementFeeShares));
        UFixed6 claimAmount = _socialize(context, claimAssets);

        context.global.update(context.global.latest, claimAssets, redeemShares, depositAmount, redemptionAmount);
        context.local.update(context.currentId, claimAssets, redeemShares, depositAmount, redemptionAmount);
        context.currentCheckpoint.update(depositAmount, redemptionAmount);

        asset.pull(msg.sender, UFixed18Lib.from(depositAssets));

        _manage(context, claimAmount, true);

        asset.push(account, UFixed18Lib.from(claimAmount));

        emit Update(msg.sender, account, context.currentId, depositAssets, redeemShares, claimAssets);
    }

    function _settleUnderlying() private {
        for (uint256 marketId; marketId < totalMarkets; marketId++)
            _registrations[marketId].read().market.update(
                address(this),
                UFixed6Lib.MAX,
                UFixed6Lib.ZERO,
                UFixed6Lib.ZERO,
                Fixed6Lib.ZERO,
                false
            );
    }

    /**
     * @notice Hook that is called before every stateful operation
     * @dev Settles the vault's account on both the long and short product, along with any global or user-specific deposits/redemptions
     * @param account The account that called the operation, or 0 if called by a keeper.
     * @return context The current epoch contexts for each market
     */
    /// @dev context -- context.global
    /// @dev context -- context.global.latest
    /// @dev context -- context.latestId
    /// @dev context -- context.local.*
    /// @dev context -- context.currentCheckpoint
    /// @dev context -- context.parameter
    /// @dev context -- context.markets.length
    /// @dev context -- context.markets[marketId].registration
    function _settle(Context memory context) private {
        // process pending deltas
        while (context.latestId > context.global.latest) {
            uint256 checkpointId = context.global.latest + 1;
            context.latestCheckpoint = _checkpoints[checkpointId].read();
            context.latestCheckpoint.complete(_collateralAtId(context, checkpointId));
            _checkpoints[checkpointId].store(context.latestCheckpoint);
            context.global.process(
                checkpointId,
                context.latestCheckpoint,
                context.latestCheckpoint.deposit,
                context.latestCheckpoint.redemption
            );
        }
        if (context.latestId >= context.local.latest) {
            Checkpoint memory checkpoint = _checkpoints[context.local.latest].read();
            context.local.process(context.local.latest, checkpoint, context.local.deposit, context.local.redemption);
        }

        // sync data for new id
        context.currentCheckpoint.initialize(context.global, asset.balanceOf());
    }

    /**
     * @notice Manages the internal collateral and position strategy of the vault
     * @param withdrawAmount The amount of assets that need to be withdrawn from the markets into the vault
     * @param rebalance Whether to rebalance the vault's position
     */
    function _manage(Context memory context, UFixed6 withdrawAmount, bool rebalance) private {
        if (!rebalance) return; // TODO: support withdrawing w/o rebalance

        Fixed6 collateralInVault = _collateral(context).sub(Fixed6Lib.from(withdrawAmount));

        // if negative assets, skip rebalance
        if (collateralInVault.lt(Fixed6Lib.ZERO)) return;

        // Compute available collateral
        UFixed6 collateral = UFixed6Lib.from(collateralInVault);
        if (collateral.muldiv(context.minWeight, context.totalWeight).lt(context.minCollateral))
            collateral = UFixed6Lib.ZERO;

        // Compute available assets
        UFixed6 assets = UFixed6Lib.from(
                collateralInVault
                    .sub(Fixed6Lib.from(context.global.assets.add(context.global.deposit)))
                    .max(Fixed6Lib.ZERO)
            )
            .mul(context.global.shares.unsafeDiv(context.global.shares.add(context.global.redemption)))
            .add(context.global.deposit);
        if (assets.muldiv(context.minWeight, context.totalWeight).lt(context.minCollateral))
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
            target.collateral,
            false
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

        ProtocolParameter memory protocolParameter = IVaultFactory(address(factory())).marketFactory().parameter();
        context.settlementFee = protocolParameter.settlementFee;
        context.minCollateral = protocolParameter.minCollateral;

        context.latestId = type(uint256).max;
        context.minWeight = type(uint256).max;

        context.markets = new MarketContext[](totalMarkets);

        for (uint256 marketId; marketId < context.markets.length; marketId++) {
            Registration memory registration = _registrations[marketId].read();
            MarketParameter memory marketParameter = registration.market.parameter();
            RiskParameter memory riskParameter = registration.market.riskParameter();
            uint256 currentTimestamp = registration.market.oracle().current();

            context.markets[marketId].registration = registration;
            context.markets[marketId].closed = marketParameter.closed;
            context.markets[marketId].makerLimit = riskParameter.makerLimit;

            // global
            Global memory global = registration.market.global();
            Position memory currentPosition = registration.market.pendingPosition(global.currentId);
            Position memory latestPosition = registration.market.position();
            OracleVersion memory latestOracleVersion = registration.market.at(latestPosition.timestamp);

            context.markets[marketId].price = latestOracleVersion.valid ? // TODO: idk if this actually works
                latestOracleVersion.price.abs() :
                global.latestPrice.abs();
            context.markets[marketId].currentPosition = currentPosition.maker;
            context.markets[marketId].currentNet = currentPosition.net();
            if (latestPosition.id < context.latestId) context.latestId = latestPosition.id;
            context.makerFee = context.makerFee
                .add(riskParameter.makerFee.mul(context.parameter.leverage).mul(UFixed6Lib.from(registration.weight)));
            context.totalWeight += registration.weight;
            if (registration.weight < context.minWeight) context.minWeight = registration.weight;

            // local
            Local memory local = registration.market.locals(address(this));
            currentPosition = registration.market.pendingPositions(address(this), local.currentId);

            context.markets[marketId].currentPositionAccount = currentPosition.maker;
            context.markets[marketId].collateral = local.collateral;

            if (local.protection > context.protection) context.protection = local.protection;
            if (marketId == 0) context.currentId = currentTimestamp > currentPosition.timestamp ? local.currentId + 1 : local.currentId;
        }

        if (context.totalWeight != 0) context.makerFee = context.makerFee.div(UFixed6Lib.from(context.totalWeight));

        context.global = _accounts[address(0)].read();
        context.local = _accounts[account].read();
        context.latestCheckpoint = _checkpoints[context.global.latest].read();
        context.currentCheckpoint = _checkpoints[context.currentId].read();
    }

    function _saveContext(Context memory context, address account) private {
        _checkpoints[context.currentId].store(context.currentCheckpoint);
        _accounts[address(0)].store(context.global);
        _accounts[account].store(context.local);
    }

    /**
     * @notice The maximum available deposit amount at the given epoch
     * @param context Epoch context to use in calculation
     * @return Maximum available deposit amount at epoch
     */
    function _maxDeposit(Context memory context) private view returns (UFixed6) {
        if (context.latestCheckpoint.unhealthy()) return UFixed6Lib.ZERO;
        UFixed6 collateral = UFixed6Lib.from(totalAssets().max(Fixed6Lib.ZERO)).add(context.global.deposit);
        return context.global.assets.add(context.parameter.cap.sub(collateral.min(context.parameter.cap)));
    }

    /**
     * @notice The maximum available redeemable amount at the given epoch for `account`
     * @param context Epoch context to use in calculation
     * @return redemptionAmount Maximum available redeemable amount at epoch
     */
    function _maxRedeem(Context memory context) private pure returns (UFixed6 redemptionAmount) {
        if (context.latestCheckpoint.unhealthy()) return UFixed6Lib.ZERO;

        redemptionAmount = UFixed6Lib.MAX;
        for (uint256 marketId; marketId < context.markets.length; marketId++) {
            MarketContext memory marketContext = context.markets[marketId];

            UFixed6 collateral = marketContext.currentPosition
                .sub(marketContext.currentNet.min(marketContext.currentPosition))   // available maker
                .muldiv(marketContext.price, context.parameter.leverage)            // available collateral
                .muldiv(context.totalWeight, marketContext.registration.weight);    // collateral in market

            redemptionAmount = redemptionAmount.min(context.latestCheckpoint.toShares(collateral));
        }
    }

    /**
     * @notice Returns the real amount of collateral in the vault
     * @return value The real amount of collateral in the vault
     **/
    function _collateral(Context memory context) public view returns (Fixed6 value) {
        value = Fixed6Lib.from(UFixed6Lib.from(asset.balanceOf()));
        for (uint256 marketId; marketId < context.markets.length; marketId++)
            value = value.add(context.markets[marketId].collateral);
    }

    //// @dev context -- context.markets.length
    //// @dev context -- context.markets[marketId].registration
    function _collateralAtId(Context memory context, uint256 id) public view returns (Fixed6 value) {
        for (uint256 marketId; marketId < context.markets.length; marketId++)
            value = value.add(
                context.markets[marketId].registration.market.pendingPositions(
                    address(this),
                    id - context.markets[marketId].registration.initialId
                ).collateral
            );
    }
}
