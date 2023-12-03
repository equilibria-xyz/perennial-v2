//SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "@equilibria/root/attribute/Instance.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./interfaces/IVaultFactory.sol";
import "./types/Account.sol";
import "./types/Checkpoint.sol";
import "./types/Registration.sol";
import "./types/Mapping.sol";
import "./types/VaultParameter.sol";
import "./interfaces/IVault.sol";
import "./lib/StrategyLib.sol";

/// @title Vault
/// @notice Deploys underlying capital by weight in maker positions across registered markets
/// @dev Vault deploys and rebalances collateral between the registered markets, while attempting to
///      maintain `targetLeverage` with its open maker positions at any given time. Deposits are only gated in so much
///      as to cap the maximum amount of assets in the vault.
///
///      All registered markets are expected to be on the same "clock", i.e. their oracle.current() is always equal.
///
///      The vault has a "delayed settlement" mechanism. After depositing to or redeeming from the vault, a user must
///      wait until the next settlement of all underlying markets in order for vault settlement to be available.
contract Vault is IVault, Instance {
    /// @dev The vault's name
    string private _name;

    /// @dev The underlying asset
    Token18 public asset;

    /// @dev The vault parameter set
    VaultParameterStorage private _parameter;

    /// @dev The total number of registered markets
    uint256 public totalMarkets;

    /// @dev Per-market registration state variables
    mapping(uint256 => RegistrationStorage) private _registrations;

    /// @dev Per-account accounting state variables
    mapping(address => AccountStorage) private _accounts;

    /// @dev Per-id accounting state variables
    mapping(uint256 => CheckpointStorage) private _checkpoints;

    /// @dev Per-id id-mapping state variables
    mapping(uint256 => MappingStorage) private _mappings;

    /// @notice Initializes the vault
    /// @param asset_ The underlying asset
    /// @param initialMarket The initial market to register
    /// @param name_ The vault's name
    function initialize(
        Token18 asset_,
        IMarket initialMarket,
        UFixed6 cap,
        string calldata name_
    ) external initializer(1) {
        __Instance__initialize();

        asset = asset_;
        _name = name_;
        _register(initialMarket);
        _updateMarket(0, 1, UFixed6Lib.ZERO);
        _updateParameter(VaultParameter(cap));
    }

    /// @notice Returns the vault parameter set
    /// @return The vault parameter set
    function parameter() external view returns (VaultParameter memory) {
        return _parameter.read();
    }

    /// @notice Returns the registration for a given market
    /// @param marketId The market id
    /// @return The registration for the given market
    function registrations(uint256 marketId) external view returns (Registration memory) {
        return _registrations[marketId].read();
    }

    /// @notice Returns the account state for a account
    /// @param account The account to query
    /// @return The account state for the given account
    function accounts(address account) external view returns (Account memory) {
        return _accounts[account].read();
    }

    /// @notice Returns the checkpoint for a given id
    /// @param id The id to query
    /// @return The checkpoint for the given id
    function checkpoints(uint256 id) external view returns (Checkpoint memory) {
        return _checkpoints[id].read();
    }

    /// @notice Returns the mapping for a given id
    /// @param id The id to query
    /// @return The mapping for the given id
    function mappings(uint256 id) external view returns (Mapping memory) {
        return _mappings[id].read();
    }

    /// @notice Returns the name of the vault
    /// @return The name of the vault
    function name() external view returns (string memory) {
        return string(abi.encodePacked("Perennial V2 Vault: ", _name));
    }

    /// @notice Returns the total number of underlying assets at the last checkpoint
    /// @return The total number of underlying assets at the last checkpoint
    function totalAssets() public view returns (Fixed6) {
        Checkpoint memory checkpoint = _checkpoints[_accounts[address(0)].read().latest].read();
        return checkpoint.assets
            .add(Fixed6Lib.from(checkpoint.deposit))
            .sub(Fixed6Lib.from(checkpoint.toAssetsGlobal(checkpoint.redemption)));
    }

    /// @notice Returns the total number of shares at the last checkpoint
    /// @return The total number of shares at the last checkpoint
    function totalShares() public view returns (UFixed6) {
        Checkpoint memory checkpoint = _checkpoints[_accounts[address(0)].read().latest].read();
        return checkpoint.shares
            .add(checkpoint.toSharesGlobal(checkpoint.deposit))
            .sub(checkpoint.redemption);
    }

    /// @notice Converts a given amount of assets to shares
    /// @param assets Number of assets to convert to shares
    /// @return Amount of shares for the given assets
    function convertToShares(UFixed6 assets) external view returns (UFixed6) {
        (UFixed6 _totalAssets, UFixed6 _totalShares) =
            (UFixed6Lib.unsafeFrom(totalAssets()), totalShares());
        return _totalShares.isZero() ? assets : assets.muldiv(_totalShares, _totalAssets);
    }

    /// @notice Converts a given amount of shares to assets
    /// @param shares Number of shares to convert to assets
    /// @return Amount of assets for the given shares
    function convertToAssets(UFixed6 shares) external view returns (UFixed6) {
        (UFixed6 _totalAssets, UFixed6 _totalShares) =
            (UFixed6Lib.unsafeFrom(totalAssets()), totalShares());
        return _totalShares.isZero() ? shares : shares.muldiv(_totalAssets, _totalShares);
    }

    /// @notice Registers a new market
    /// @param market The market to register
    function register(IMarket market) external onlyOwner {
        settle(address(0));

        for (uint256 marketId; marketId < totalMarkets; marketId++) {
            if (_registrations[marketId].read().market == market) revert VaultMarketExistsError();
        }

        _register(market);
    }

    /// @notice Handles the registration for a new market
    /// @param market The market to register
    function _register(IMarket market) private {
        if (!IVaultFactory(address(factory())).marketFactory().instances(market)) revert VaultNotMarketError();
        if (!market.token().eq(asset)) revert VaultIncorrectAssetError();

        asset.approve(address(market));

        uint256 newMarketId = totalMarkets++;
        _registrations[newMarketId].store(Registration(market, 0, UFixed6Lib.ZERO));
        emit MarketRegistered(newMarketId, market);
    }

    /// @notice Settles, then updates the registration parameters for a given market
    /// @param marketId The market id
    /// @param newWeight The new weight
    /// @param newLeverage The new leverage
    function updateMarket(uint256 marketId, uint256 newWeight, UFixed6 newLeverage) external onlyOwner {
        settle(address(0));
        _updateMarket(marketId, newWeight, newLeverage);
    }

    /// @notice Updates the registration parameters for a given market
    /// @param marketId The market id
    /// @param newWeight The new weight
    /// @param newLeverage The new leverage
    function _updateMarket(uint256 marketId, uint256 newWeight, UFixed6 newLeverage) private {
        if (marketId >= totalMarkets) revert VaultMarketDoesNotExistError();

        Registration memory registration = _registrations[marketId].read();
        registration.weight = newWeight;
        registration.leverage = newLeverage;
        _registrations[marketId].store(registration);
        emit MarketUpdated(marketId, newWeight, newLeverage);
    }

    /// @notice Settles, then updates the vault parameter set
    /// @param newParameter The new vault parameter set
    function updateParameter(VaultParameter memory newParameter) external onlyOwner {
        settle(address(0));
        _updateParameter(newParameter);
    }

    /// @notice Updates the vault parameter set
    /// @param newParameter The new vault parameter set
    function _updateParameter(VaultParameter memory newParameter) private {
        _parameter.store(newParameter);
        emit ParameterUpdated(newParameter);
    }

    /// @notice Syncs `account`'s state up to current
    /// @param account The account that should be synced
    function settle(address account) public whenNotPaused {
        _settleUnderlying();
        Context memory context = _loadContext(account);

        _settle(context, account);
        _manage(context, UFixed6Lib.ZERO, UFixed6Lib.ZERO, false);
        _saveContext(context, account);
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

        _settle(context, account);
        _checkpoint(context);
        _update(context, account, depositAssets, redeemShares, claimAssets);
        _saveContext(context, account);
    }

    /// @notice loads or initializes the current checkpoint
    /// @param context The context to use
    function _checkpoint(Context memory context) private {
        context.currentId = context.global.current;
        if (_mappings[context.currentId].read().next(context.currentIds)) {
            context.currentId++;
            context.currentCheckpoint.initialize(context.global);
            _mappings[context.currentId].store(context.currentIds);
        } else {
            context.currentCheckpoint = _checkpoints[context.currentId].read();
        }
    }

    /// @notice Handles updating the account's position
    /// @param context The context to use
    /// @param account The account to operate on
    /// @param depositAssets The amount of assets to deposit
    /// @param redeemShares The amount of shares to redeem
    /// @param claimAssets The amount of assets to claim
    function _update(
        Context memory context,
        address account,
        UFixed6 depositAssets,
        UFixed6 redeemShares,
        UFixed6 claimAssets
    ) private {
        // load strategy
        context.strategy = StrategyLib.load(context.registrations);

        // magic values
        if (claimAssets.eq(UFixed6Lib.MAX)) claimAssets = context.local.assets;
        if (redeemShares.eq(UFixed6Lib.MAX)) redeemShares = context.local.shares;

        // invariant
        if (msg.sender != account && !IVaultFactory(address(factory())).operators(account, msg.sender))
            revert VaultNotOperatorError();
        if (!depositAssets.add(redeemShares).add(claimAssets).eq(depositAssets.max(redeemShares).max(claimAssets)))
            revert VaultNotSingleSidedError();
        if (depositAssets.gt(_maxDeposit(context)))
            revert VaultDepositLimitExceededError();
        if (redeemShares.gt(_maxRedeem(context)))
            revert VaultRedemptionLimitExceededError();
        if (!depositAssets.isZero() && depositAssets.lt(context.settlementFee))
            revert VaultInsufficientMinimumError();
        if (!redeemShares.isZero() && context.latestCheckpoint.toAssets(redeemShares, context.settlementFee).isZero())
            revert VaultInsufficientMinimumError();
        if (context.local.current != context.local.latest) revert VaultExistingOrderError();

        // asses socialization and settlement fee
        UFixed6 claimAmount = _socialize(context, depositAssets, redeemShares, claimAssets);

        // update positions
        context.global.update(context.currentId, claimAssets, redeemShares, depositAssets, redeemShares);
        context.local.update(context.currentId, claimAssets, redeemShares, depositAssets, redeemShares);
        context.currentCheckpoint.update(depositAssets, redeemShares);

        // manage assets
        asset.pull(msg.sender, UFixed18Lib.from(depositAssets));
        _manage(context, depositAssets, claimAmount, true);
        asset.push(msg.sender, UFixed18Lib.from(claimAmount));

        emit Updated(msg.sender, account, context.currentId, depositAssets, redeemShares, claimAssets);
    }

    /// @notice Returns the claim amount after socialization and settlement fee
    /// @param context The context to use
    /// @param depositAssets The amount of assets to deposit
    /// @param redeemShares The amount of shares to redeem
    /// @param claimAssets The amount of assets to claim
    function _socialize(
        Context memory context,
        UFixed6 depositAssets,
        UFixed6 redeemShares,
        UFixed6 claimAssets
    ) private pure returns (UFixed6 claimAmount) {
        claimAmount = context.global.assets.isZero() ?
            UFixed6Lib.ZERO :
            claimAssets.muldiv(
                UFixed6Lib.unsafeFrom(context.totalCollateral).min(context.global.assets),
                context.global.assets
            );

        if (depositAssets.isZero() && redeemShares.isZero()) claimAmount = claimAmount.sub(context.settlementFee);
    }

    /// @notice Handles settling the vault's underlying markets
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

    /// @notice Handles settling the vault state
    /// @dev Run before every stateful operation to settle up the latest global state of the vault
    /// @param context The context to use
    function _settle(Context memory context, address account) private {
        // settle global positions
        while (
            context.global.current > context.global.latest &&
            _mappings[context.global.latest + 1].read().ready(context.latestIds)
        ) {
            uint256 newLatestId = context.global.latest + 1;
            context.latestCheckpoint = _checkpoints[newLatestId].read();
            (Fixed6 collateralAtId, UFixed6 feeAtId, UFixed6 keeperAtId) = _collateralAtId(context, newLatestId);
            context.latestCheckpoint.complete(collateralAtId, feeAtId, keeperAtId);

            context.global.processGlobal(
                newLatestId,
                context.latestCheckpoint,
                context.latestCheckpoint.deposit,
                context.latestCheckpoint.redemption
            );
            _checkpoints[newLatestId].store(context.latestCheckpoint);
        }

        if (account == address(0)) return;

        // settle local position
        if (
            context.local.current > context.local.latest &&
            _mappings[context.local.current].read().ready(context.latestIds)
        ) {
            uint256 newLatestId = context.local.current;
            Checkpoint memory checkpoint = _checkpoints[newLatestId].read();
            context.local.processLocal(
                newLatestId,
                checkpoint,
                context.local.deposit,
                context.local.redemption
            );
        }
    }

    /// @notice Manages the internal collateral and position strategy of the vault
    /// @param deposit The amount of assets that are being deposited into the vault
    /// @param withdrawal The amount of assets that need to be withdrawn from the markets into the vault
    /// @param rebalance Whether to rebalance the vault's position
    function _manage(Context memory context, UFixed6 deposit, UFixed6 withdrawal, bool rebalance) private {
        // for now, skip all rebalancing if we cannot rebalance the position
        if (!rebalance || context.totalCollateral.lt(Fixed6Lib.ZERO)) return;

        StrategyLib.MarketTarget[] memory targets = context.strategy.allocate(
            context.registrations,
            deposit,
            withdrawal,
            _ineligable(context, withdrawal)
        );

        for (uint256 marketId; marketId < context.registrations.length; marketId++)
            if (targets[marketId].collateral.lt(Fixed6Lib.ZERO))
                _retarget(context.registrations[marketId], targets[marketId]);
        for (uint256 marketId; marketId < context.registrations.length; marketId++)
            if (targets[marketId].collateral.gte(Fixed6Lib.ZERO))
                _retarget(context.registrations[marketId], targets[marketId]);
    }

    /// @notice Returns the amount of collateral is ineligable for allocation
    /// @param context The context to use
    /// @param withdrawal The amount of assets that need to be withdrawn from the markets into the vault
    /// @return The amount of assets that are ineligable from being allocated
    function _ineligable(Context memory context, UFixed6 withdrawal) private pure returns (UFixed6) {
        // assets eligable for redemption
        UFixed6 redemptionEligable = UFixed6Lib.unsafeFrom(context.totalCollateral)
            .unsafeSub(withdrawal)
            .unsafeSub(context.global.assets)
            .unsafeSub(context.global.deposit);

        return redemptionEligable
            // approximate assets up for redemption
            .mul(context.global.shares.unsafeDiv(context.global.shares.add(context.global.redemption)))
            // deploy assets up for deposit
            .add(context.global.deposit);
    }

    /// @notice Adjusts the position on `market` to `targetPosition`
    /// @param target The new state to target
    function _retarget(Registration memory registration, StrategyLib.MarketTarget memory target) private {
        registration.market.update(
            address(this),
            target.position,
            UFixed6Lib.ZERO,
            UFixed6Lib.ZERO,
            target.collateral,
            false
        );
    }

    /// @notice Loads the context for the given `account`
    /// @param account Account to load the context for
    /// @return context The context
    function _loadContext(address account) private view returns (Context memory context) {
        context.parameter = _parameter.read();

        context.currentIds.initialize(totalMarkets);
        context.latestIds.initialize(totalMarkets);
        context.registrations = new Registration[](totalMarkets);
        context.collaterals = new Fixed6[](totalMarkets);

        for (uint256 marketId; marketId < totalMarkets; marketId++) {
            // parameter
            Registration memory registration = _registrations[marketId].read();
            MarketParameter memory marketParameter = registration.market.parameter();

            context.registrations[marketId] = registration;
            context.totalWeight += registration.weight;
            context.settlementFee = context.settlementFee.add(marketParameter.settlementFee);

            // local
            Local memory local = registration.market.locals(address(this));
            context.latestIds.update(marketId, local.latestId);
            context.currentIds.update(marketId, local.currentId);
            context.collaterals[marketId] = local.collateral;
            context.totalCollateral = context.totalCollateral.add(local.collateral);
        }

        if (account != address(0)) context.local = _accounts[account].read();
        context.global = _accounts[address(0)].read();
        context.latestCheckpoint = _checkpoints[context.global.latest].read();
    }

    /// @notice Saves the context into storage
    /// @param context Context to use
    /// @param account Account to save the context for
    function _saveContext(Context memory context, address account) private {
        if (account != address(0)) _accounts[account].store(context.local);
        _accounts[address(0)].store(context.global);
        _checkpoints[context.currentId].store(context.currentCheckpoint);
    }

    /// @notice The maximum available deposit amount
    /// @param context Context to use in calculation
    /// @return Maximum available deposit amount
    function _maxDeposit(Context memory context) private view returns (UFixed6) {
        if (context.latestCheckpoint.unhealthy()) return UFixed6Lib.ZERO;
        UFixed6 collateral = UFixed6Lib.unsafeFrom(totalAssets()).add(context.global.deposit);
        return context.parameter.cap.unsafeSub(collateral);
    }

    /// @notice The maximum available redemption amount for `account`
    /// @param context Context to use
    /// @return redemptionAmount Maximum available redemption amount
    function _maxRedeem(Context memory context) private pure returns (UFixed6) {
        if (context.latestCheckpoint.unhealthy()) return UFixed6Lib.ZERO;
        UFixed6 maxRedeemAssets = context.strategy.maxRedeem(
            context.registrations,
            context.totalWeight,
            UFixed6Lib.unsafeFrom(_collateral(context))
        );
        UFixed6 maxRedeemShares = maxRedeemAssets.eq(UFixed6Lib.MAX) ?
            UFixed6Lib.MAX :
            context.latestCheckpoint.toShares(maxRedeemAssets, UFixed6Lib.ZERO);

        return maxRedeemShares.min(context.local.shares);
    }

    /// @notice Returns the collateral and fee information for the vault at position
    /// @param context Context to use
    /// @param id Position to use
    /// @return value The snapshotted amount of collateral in the vault
    /// @return fee The snapshotted amount of fee in that position
    /// @return keeper The snapshotted amount of keeper in that position
    function _collateralAtId(Context memory context, uint256 id) public view returns (Fixed6 value, UFixed6 fee, UFixed6 keeper) {
        Mapping memory mappingAtId = _mappings[id].read();
        for (uint256 marketId; marketId < mappingAtId.length(); marketId++) {
            Position memory currentAccountPosition = context.registrations[marketId].market
                .pendingPositions(address(this), mappingAtId.get(marketId));
            value = value.add(currentAccountPosition.collateral);
            fee = fee.add(UFixed6Lib.unsafeFrom(currentAccountPosition.fee)); // Maker fee cannot be negative as of v2.1
            keeper = keeper.add(currentAccountPosition.keeper);
        }
    }
}
