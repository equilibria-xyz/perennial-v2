//SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "@equilibria/root-v2/contracts/Instance.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./interfaces/IVaultFactory.sol";
import "./types/Account.sol";
import "./types/Checkpoint.sol";
import "./types/Registration.sol";
import "./types/Mapping.sol";
import "./types/VaultParameter.sol";
import "./interfaces/IVault.sol";
import "./lib/StrategyLib.sol";

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

    /// @dev Per-account accounting state variables
    mapping(address => AccountStorage) private _accounts;

    /// @dev Per-id accounting state variables
    mapping(uint256 => CheckpointStorage) private _checkpoints;

    /// @dev Per-id id-mapping state variables
    mapping(uint256 => MappingStorage) private _mappings;

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
        _register(initialMarket);
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
        settle(address(0));

        for (uint256 marketId; marketId < totalMarkets; marketId++) {
            if (_registrations[marketId].read().market == market) revert VaultMarketExistsError();
        }

        _register(market);
    }

    function _register(IMarket market) private {
        if (!IVaultFactory(address(factory())).marketFactory().instances(market)) revert VaultNotMarketError();
        if (!market.token().eq(asset)) revert VaultIncorrectAssetError();

        asset.approve(address(market));

        uint256 newMarketId = totalMarkets++;
        _registrations[newMarketId].store(Registration(market, 0, UFixed6Lib.ZERO));
        emit MarketRegistered(newMarketId, market);
    }

    function updateMarket(uint256 marketId, uint256 newWeight, UFixed6 newLeverage) external onlyOwner {
        settle(address(0));

        if (marketId >= totalMarkets) revert VaultMarketDoesNotExistError();

        Registration memory registration = _registrations[marketId].read();
        registration.weight = newWeight;
        registration.leverage = newLeverage;
        _registrations[marketId].store(registration);
        emit MarketUpdated(marketId, newWeight, newLeverage);
    }

    function updateParameter(VaultParameter memory newParameter) external onlyOwner {
        settle(address(0));

        _parameter.store(newParameter);
        emit ParameterUpdated(newParameter);
    }

    function claimReward() external onlyOwner {
        for (uint256 marketId; marketId < totalMarkets; marketId++) {
            _registrations[marketId].read().market.claimReward();
            _registrations[marketId].read().market.reward().push(factory().owner());
        }
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

    function _settlementFee(Context memory context) private pure returns (UFixed6 assets, UFixed6 shares) {
        assets = context.settlementFee;
        shares = context.latestCheckpoint.toShares(assets);
    }

    function _socialize(Context memory context, UFixed6 claimAssets) private view returns (UFixed6) {
        if (context.global.assets.isZero()) return UFixed6Lib.ZERO;
        UFixed6 totalCollateral = UFixed6Lib.from(_collateral(context).max(Fixed6Lib.ZERO));
        return claimAssets.muldiv(totalCollateral.min(context.global.assets), context.global.assets);
    }

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
        _checkpoint(context);
        _update(context, account, depositAssets, redeemShares, claimAssets);
        _saveContext(context, account);
    }

    function _checkpoint(Context memory context) private {
        context.currentId = context.global.current;
        if (_mappings[context.currentId].read().next(context.currentIds)) {
            context.currentId++;
            context.currentCheckpoint.initialize(context.global, asset.balanceOf());
            _mappings[context.currentId].store(context.currentIds);
        } else {
            context.currentCheckpoint = _checkpoints[context.currentId].read();
        }
    }

    function _update(
        Context memory context,
        address account,
        UFixed6 depositAssets,
        UFixed6 redeemShares,
        UFixed6 claimAssets
    ) private {
        // TODO: move to invariant
        // invariant
        if (msg.sender != account && !IVaultFactory(address(factory())).operators(account, msg.sender))
            revert VaultNotOperatorError();
        if (!depositAssets.add(redeemShares).add(claimAssets).eq(depositAssets.max(redeemShares).max(claimAssets)))
            revert VaultNotSingleSidedError();
        if (depositAssets.gt(_maxDeposit(context))) revert VaultDepositLimitExceededError();
        if (redeemShares.gt(_maxRedeem(context))) revert VaultRedemptionLimitExceededError();
        if (context.local.current != context.local.latest) revert VaultExistingOrderError();

        // magic values
        if (claimAssets.eq(UFixed6Lib.MAX)) claimAssets = context.local.assets;

        // asses fees
        (UFixed6 settlementFeeAssets, UFixed6 settlementFeeShares) = _settlementFee(context);
        UFixed6 depositAmount = depositAssets.sub(settlementFeeAssets);
        UFixed6 redemptionAmount = redeemShares.sub(settlementFeeShares);
        UFixed6 claimAmount = _socialize(context, claimAssets).sub(settlementFeeAssets);

        // update positions
        context.global.update(context.currentId, claimAssets, redeemShares, depositAmount, redemptionAmount);
        context.local.update(context.currentId, claimAssets, redeemShares, depositAmount, redemptionAmount);
        context.currentCheckpoint.update(depositAmount, redemptionAmount);

        // manage assets
        asset.pull(msg.sender, UFixed18Lib.from(depositAssets));
        _manage(context, claimAmount, true);
        asset.push(msg.sender, UFixed18Lib.from(claimAmount));

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
    /// @dev context -- context.local
    /// @dev context -- context.currentCheckpoint
    /// @dev context -- context.parameter
    /// @dev context -- context.markets.length
    /// @dev context -- context.markets[marketId].registration.market
    function _settle(Context memory context) private {
        // settle global positions
        while (
            context.global.current > context.global.latest &&
            _mappings[context.global.latest + 1].read().ready(context.latestIds)
        ) {
            uint256 newLatestId = context.global.latest + 1;
            context.latestCheckpoint = _checkpoints[newLatestId].read();
            (Fixed6 collateralAtId, UFixed6 feeAtId) = _collateralAtId(context, newLatestId);
            context.latestCheckpoint.complete(collateralAtId, feeAtId);
            context.global.process(
                newLatestId,
                context.latestCheckpoint,
                context.latestCheckpoint.deposit,
                context.latestCheckpoint.redemption
            );
            _checkpoints[newLatestId].store(context.latestCheckpoint);
        }

        // settle local position
        if (
            context.local.current > context.local.latest &&
            _mappings[context.local.current].read().ready(context.latestIds)
        ) {
            uint256 newLatestId = context.local.current;
            Checkpoint memory checkpoint = _checkpoints[newLatestId].read();
            context.local.process(
                newLatestId,
                checkpoint,
                context.local.deposit,
                context.local.redemption
            );
        }
    }

    /**
     * @notice Manages the internal collateral and position strategy of the vault
     * @param withdrawAmount The amount of assets that need to be withdrawn from the markets into the vault
     * @param rebalance Whether to rebalance the vault's position
     */
    function _manage(Context memory context, UFixed6 withdrawAmount, bool rebalance) private {
        (Fixed6 collateral, UFixed6 assets) = _treasury(context, withdrawAmount);

        if (!rebalance || collateral.lt(Fixed6Lib.ZERO)) return; // TODO: support withdrawing w/o rebalance

        StrategyLib.MarketTarget[] memory targets = StrategyLib.allocate(
            context.registrations,
            UFixed6Lib.from(collateral.max(Fixed6Lib.ZERO)),
            assets
        );

        for (uint256 marketId; marketId < context.markets.length; marketId++)
            if (targets[marketId].collateral.lt(Fixed6Lib.ZERO))
                _update(context.registrations[marketId], targets[marketId]);
        for (uint256 marketId; marketId < context.markets.length; marketId++)
            if (targets[marketId].collateral.gte(Fixed6Lib.ZERO))
                _update(context.registrations[marketId], targets[marketId]);
    }

    function _treasury(Context memory context, UFixed6 withdrawAmount) private view returns (Fixed6 collateral, UFixed6 assets) {
        collateral = _collateral(context).sub(Fixed6Lib.from(withdrawAmount));

        // collateral currently deployed
        Fixed6 liabilities = Fixed6Lib.from(context.global.assets.add(context.global.deposit));
        // net assets
        assets = UFixed6Lib.from(collateral.sub(liabilities).max(Fixed6Lib.ZERO))
            // approximate assets up for redemption
            .mul(context.global.shares.unsafeDiv(context.global.shares.add(context.global.redemption)))
            // add buffer to approximation to account for price changes
            // TODO
            // deploy assets up for deposit
            .add(context.global.deposit);
    }

    /**
     * @notice Adjusts the position on `market` to `targetPosition`
     * @param target The new state to target
     */
    function _update(Registration memory registration, StrategyLib.MarketTarget memory target) private {
        registration.market.update(
            address(this),
            target.position,
            UFixed6Lib.ZERO,
            UFixed6Lib.ZERO,
            target.collateral,
            false
        );
    }

    /**
     * @notice Loads the context for the given `account`
     * @param account Account to load the context for
     * @return context Epoch context
     */
    function _loadContext(address account) private view returns (Context memory context) {
        context.parameter = _parameter.read();

        context.currentIds.initialize(totalMarkets);
        context.latestIds.initialize(totalMarkets);
        context.registrations = new Registration[](totalMarkets);
        context.markets = new MarketContext[](totalMarkets);

        for (uint256 marketId; marketId < totalMarkets; marketId++) {
            // parameter
            Registration memory registration = _registrations[marketId].read();
            MarketParameter memory marketParameter = registration.market.parameter();
            context.registrations[marketId] = registration;
            context.settlementFee = context.settlementFee.add(marketParameter.settlementFee);

            // global
            Global memory global = registration.market.global();
            Position memory currentPosition = registration.market.pendingPosition(global.currentId);
            Position memory latestPosition = registration.market.position();
            OracleVersion memory latestOracleVersion = registration.market.at(latestPosition.timestamp);

            context.markets[marketId].price = latestOracleVersion.valid ? // TODO: clean all this up
                latestOracleVersion.price.abs() :
                global.latestPrice.abs();
            context.markets[marketId].currentPosition = currentPosition.maker;
            context.markets[marketId].currentNet = currentPosition.net();
            context.totalWeight += registration.weight;

            // local
            Local memory local = registration.market.locals(address(this));
            context.markets[marketId].collateral = local.collateral;

            // ids
            context.latestIds.update(marketId, latestPosition.id);
            context.currentIds.update(marketId, local.currentId);
        }

        context.global = _accounts[address(0)].read();
        context.local = _accounts[account].read();
        context.latestCheckpoint = _checkpoints[context.global.latest].read();
    }

    function _saveContext(Context memory context, address account) private {
        _accounts[address(0)].store(context.global);
        _accounts[account].store(context.local);
        _checkpoints[context.currentId].store(context.currentCheckpoint);
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
            Registration memory registration = context.registrations[marketId];

            UFixed6 collateral = marketContext.currentPosition
                .sub(marketContext.currentNet.min(marketContext.currentPosition))   // available maker
                .muldiv(marketContext.price, registration.leverage)   // available collateral
                .muldiv(context.totalWeight, registration.weight);    // collateral in market

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
    // TODO: combine with Checkpoint.complete after we have registration list
    function _collateralAtId(Context memory context, uint256 id) public view returns (Fixed6 value, UFixed6 fee) {
        Mapping memory mappingAtId = _mappings[id].read();
        for (uint256 marketId; marketId < mappingAtId.length(); marketId++) {
            Position memory currentAccountPosition = context.registrations[marketId].market
                .pendingPositions(address(this), mappingAtId.get(marketId));
            value = value.add(currentAccountPosition.collateral);
            fee = fee.add(currentAccountPosition.fee);
        }
    }
}
