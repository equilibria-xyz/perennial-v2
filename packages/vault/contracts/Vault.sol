//SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { UFixed18, UFixed18Lib } from "@equilibria/root/number/types/UFixed18.sol";
import { Fixed6, Fixed6Lib } from "@equilibria/root/number/types/Fixed6.sol";
import { Token18 } from "@equilibria/root/token/types/Token18.sol";
import { Instance } from "@equilibria/root/attribute/Instance.sol";
import { IMarket } from "@perennial/v2-core/contracts/interfaces/IMarket.sol";
import { Checkpoint as PerennialCheckpoint } from  "@perennial/v2-core/contracts/types/Checkpoint.sol";
import { OracleVersion } from  "@perennial/v2-core/contracts/types/OracleVersion.sol";
import { Local } from  "@perennial/v2-core/contracts/types/Local.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { IVault } from "./interfaces/IVault.sol";
import { IVaultFactory } from "./interfaces/IVaultFactory.sol";
import { Account, AccountStorage } from "./types/Account.sol";
import { Checkpoint, CheckpointStorage } from "./types/Checkpoint.sol";
import { Registration, RegistrationStorage } from "./types/Registration.sol";
import { VaultParameter, VaultParameterStorage } from "./types/VaultParameter.sol";
import { Target } from "./types/Target.sol";
import { MakerStrategyLib } from "./libs/MakerStrategyLib.sol";

/// @title Vault
/// @notice Deploys underlying capital in a specified strategy, managing the risk and return of the capital
/// @dev Vault deploys and rebalances collateral between the registered markets per the strategy specified by the
///
///      All registered markets are expected to be on the same "clock", i.e. their oracle.current() is always equal.
///
///      The vault has a "delayed settlement" mechanism. After depositing to or redeeming from the vault, a user must
///      wait until the next settlement of all underlying markets in order for vault settlement to be available.
abstract contract Vault is IVault, Instance {
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

    /// @dev The vault's coordinator address (privileged role that can operate the vault's strategy)
    address public coordinator;

    /// @dev High-water mark for the vault's assets vs shares ratio
    UFixed18 public mark;

    /// @dev Leave gap for future upgrades since this contract is abstract
    bytes32[54] private __unallocated__;

    /// @notice Initializes the vault
    /// @param asset_ The underlying asset
    /// @param initialMarket The initial market to register
    /// @param initialDeposit The initial deposit amount
    /// @param name_ The vault's name
    function initialize(
        Token18 asset_,
        IMarket initialMarket,
        UFixed6 initialDeposit,
        string calldata name_
    ) external initializer(1) {
        __Instance__initialize();

        asset = asset_;
        _name = name_;
        _register(initialMarket);
        _updateParameter(VaultParameter(initialDeposit, UFixed6Lib.ZERO, UFixed6Lib.ZERO));
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

    /// @notice Returns the name of the vault
    /// @return The name of the vault
    function name() external view returns (string memory) {
        return string(abi.encodePacked(_vaultName(), ": ", _name));
    }

    function _vaultName() internal pure virtual returns (string memory);

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

    /// @notice Updates the Vault's coordinator address
    /// @param newCoordinator The new coordinator address
    function updateCoordinator(address newCoordinator) public virtual onlyOwner {
        coordinator = newCoordinator;
        emit CoordinatorUpdated(newCoordinator);
    }

    /// @notice Registers a new market
    /// @param market The market to register
    function register(IMarket market) external onlyOwner {
        rebalance(address(0));

        if (_isRegistered(market)) revert VaultMarketExistsError();

        _register(market);
    }

    function _isRegistered(IMarket market) internal view returns (bool) {
        for (uint256 marketId; marketId < totalMarkets; marketId++) {
            if (_registrations[marketId].read().market == market) return true;
        }
        return false;
    }

    /// @notice Handles the registration for a new market
    /// @param market The market to register
    function _register(IMarket market) private {
        if (!IVaultFactory(address(factory())).marketFactory().instances(market)) revert VaultNotMarketError();
        if (!market.token().eq(asset)) revert VaultIncorrectAssetError();

        asset.approve(address(market));

        uint256 newMarketId = _registerMarket(market);
        _updateMarket(newMarketId, newMarketId == 0 ? UFixed6Lib.ONE : UFixed6Lib.ZERO, UFixed6Lib.ZERO);
    }

    /// @notice Processes the state changes for a market registration
    /// @param market The market to register
    /// @return newMarketId The new market id
    function _registerMarket(IMarket market) private returns (uint256 newMarketId) {
        newMarketId = totalMarkets++;
        _registrations[newMarketId].store(Registration(market, UFixed6Lib.ZERO, UFixed6Lib.ZERO));
        emit MarketRegistered(newMarketId, market);
    }

    /// @notice Processes the state changes for a market update
    /// @param marketId The market id
    /// @param newWeight The new weight for the market
    /// @param newLeverage The new leverage for the market
    function _updateMarket(uint256 marketId, UFixed6 newWeight, UFixed6 newLeverage) private {
        Registration memory registration = _registrations[marketId].read();
        registration.weight = newWeight.eq(UFixed6Lib.MAX) ? registration.weight : newWeight;
        registration.leverage = newLeverage.eq(UFixed6Lib.MAX) ? registration.leverage : newLeverage;
        _registrations[marketId].store(registration);
        emit MarketUpdated(marketId, registration.weight, registration.leverage);
    }

    /// @notice Settles, then updates the registration parameters for a given market
    /// @param marketId The market id
    /// @param newLeverage The new leverage
    function updateLeverage(uint256 marketId, UFixed6 newLeverage) external onlyOwner {
        rebalance(address(0));

        if (marketId >= totalMarkets) revert VaultMarketDoesNotExistError();

        _updateMarket(marketId, UFixed6Lib.MAX, newLeverage);
    }

    /// @notice Updates the set of market weights for the vault
    /// @param newWeights The new set of market weights
    function updateWeights(UFixed6[] calldata newWeights) external onlyOwner {
        rebalance(address(0));

        if (newWeights.length != totalMarkets) revert VaultMarketDoesNotExistError();

        UFixed6 totalWeight;
        for(uint256 i; i < totalMarkets; i++) {
            _updateMarket(i, newWeights[i], UFixed6Lib.MAX);
            totalWeight = totalWeight.add(newWeights[i]);
        }

        if (!totalWeight.eq(UFixed6Lib.ONE)) revert VaultAggregateWeightError();
    }

    /// @notice Settles, then updates the vault parameter set
    /// @param newParameter The new vault parameter set
    function updateParameter(VaultParameter memory newParameter) external onlyOwner {
        rebalance(address(0));
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
        _saveContext(context, account);
    }

    /// @notice Syncs `account`'s state up to current
    /// @dev Rebalances only the collateral of the vault
    /// @param account The account that should be synced
    function rebalance(address account) public whenNotPaused {
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

    /// @notice Loads or initializes the current checkpoint
    /// @param context The context to use
    function _checkpoint(Context memory context) private view {
        context.currentId = context.global.current;
        context.currentCheckpoint = _checkpoints[context.currentId].read();

        if (context.currentTimestamp > context.currentCheckpoint.timestamp) {
            context.currentId++;
            context.currentCheckpoint.next(context.currentTimestamp, context.global);
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
        if (!depositAssets.isZero() && depositAssets.lt(context.parameter.minDeposit))
            revert VaultInsufficientMinimumError();
        if (!redeemShares.isZero() && context.latestCheckpoint.toAssets(redeemShares).lt(context.parameter.minDeposit))
            revert VaultInsufficientMinimumError();
        if (context.local.current != context.local.latest) revert VaultExistingOrderError();

        // asses socialization
        UFixed6 claimAmount = _socialize(context, claimAssets);

        // update positions
        context.global.update(context.currentId, claimAssets, redeemShares, depositAssets, redeemShares);
        context.local.update(context.currentId, claimAssets, redeemShares, depositAssets, redeemShares);
        context.currentCheckpoint.update(depositAssets, redeemShares);

        // manage assets
        asset.pull(msg.sender, UFixed18Lib.from(depositAssets));
        _manage(context, depositAssets, claimAmount, !depositAssets.isZero() || !redeemShares.isZero());
        asset.push(msg.sender, UFixed18Lib.from(claimAmount));

        emit Updated(msg.sender, account, context.currentId, depositAssets, redeemShares, claimAssets);
    }

    /// @notice Returns the claim amount after socialization
    /// @param context The context to use
    /// @param claimAssets The amount of assets to claim
    function _socialize(Context memory context, UFixed6 claimAssets) private pure returns (UFixed6) {
        return context.global.assets.isZero() ?
            UFixed6Lib.ZERO :
            claimAssets.muldiv(
                UFixed6Lib.unsafeFrom(context.totalCollateral).min(context.global.assets),
                context.global.assets
            );
    }

    /// @notice Handles settling the vault's underlying markets
    function _settleUnderlying() private {
        for (uint256 marketId; marketId < totalMarkets; marketId++)
            _registrations[marketId].read().market.settle(address(this));
    }

    /// @notice Handles settling the vault state
    /// @dev Run before every stateful operation to settle up the latest global state of the vault
    /// @param context The context to use
    function _settle(Context memory context, address account) private {
        Checkpoint memory nextCheckpoint;

        // settle global positions
        while (
            context.global.current > context.global.latest &&
            context.latestTimestamp >= (nextCheckpoint = _checkpoints[context.global.latest + 1].read()).timestamp
        ) {
            // process checkpoint
            UFixed6 profitShares;
            (context.mark, profitShares) = nextCheckpoint.complete(
                context.mark,
                context.parameter,
                _checkpointAtId(context, nextCheckpoint.timestamp)
            );
            context.global.shares = context.global.shares.add(profitShares);
            _credit(context, account, coordinator, profitShares);
            emit MarkUpdated(context.mark, profitShares);

            // process position
            context.global.processGlobal(
                context.global.latest + 1,
                nextCheckpoint,
                nextCheckpoint.deposit,
                nextCheckpoint.redemption
            );
            _checkpoints[context.global.latest].store(nextCheckpoint);
            context.latestCheckpoint = nextCheckpoint;
        }

        if (account == address(0)) return;

        // settle local position
        if (
            context.local.current > context.local.latest &&
            context.latestTimestamp >= (nextCheckpoint = _checkpoints[context.local.current].read()).timestamp
        )
            // process position
            context.local.processLocal(
                context.local.current,
                nextCheckpoint,
                context.local.deposit,
                context.local.redemption
            );
    }

    /// @notice Processes an out-of-context credit to an account
    /// @dev Used to credit shares accrued through fee mechanics
    /// @param context Settlement context
    /// @param contextAccount The account being settled
    /// @param receiver The coordinator to credit
    /// @param shares The amount of shares to credit
    function _credit(Context memory context, address contextAccount, address receiver, UFixed6 shares) internal virtual {
        // handle corner case where settling the coordinator's own account
        if (receiver == contextAccount) context.local.shares = context.local.shares.add(shares);
        else { // update coordinator profit shares
            Account memory local = _accounts[receiver].read();
            local.shares = local.shares.add(shares);
            _accounts[receiver].store(local);
        }
    }

    /// @notice Manages the internal collateral and position strategy of the vault
    /// @param deposit The amount of assets that are being deposited into the vault
    /// @param withdrawal The amount of assets that need to be withdrawn from the markets into the vault
    /// @param shouldRebalance Whether to rebalance the vault's position
    function _manage(Context memory context, UFixed6 deposit, UFixed6 withdrawal, bool shouldRebalance) private {
        if (context.totalCollateral.lt(Fixed6Lib.ZERO)) return;

        Target[] memory targets = _strategy(context, deposit, withdrawal, _ineligible(context, deposit, withdrawal));

        for (uint256 marketId; marketId < context.registrations.length; marketId++)
            if (targets[marketId].collateral.lt(Fixed6Lib.ZERO))
                _retarget(context.registrations[marketId], targets[marketId], shouldRebalance);
        for (uint256 marketId; marketId < context.registrations.length; marketId++)
            if (targets[marketId].collateral.gte(Fixed6Lib.ZERO))
                _retarget(context.registrations[marketId], targets[marketId], shouldRebalance);
    }

    /// @dev Determines how the vault allocates capital and manages positions
    /// @param context The context to use
    /// @param deposit The amount of assets that are being deposited into the vault
    /// @param withdrawal The amount of assets that need to be withdrawn from the markets into the vault
    /// @param ineligible The amount of assets that are ineligible for allocation due to pending claims
    /// @return targets Target allocations for each market; must have single entry for each registered market
    function _strategy(
        Context memory context,
        UFixed6 deposit,
        UFixed6 withdrawal,
        UFixed6 ineligible
    ) internal virtual view returns (Target[] memory targets);

    /// @notice Returns the amount of collateral is ineligible for allocation
    /// @param context The context to use
    /// @param deposit The amount of assets that are being deposited into the vault
    /// @param withdrawal The amount of assets that need to be withdrawn from the markets into the vault
    /// @return The amount of assets that are ineligible from being allocated
    function _ineligible(Context memory context, UFixed6 deposit, UFixed6 withdrawal) private pure returns (UFixed6) {
        // assets eligible for redemption
        UFixed6 redemptionEligible = UFixed6Lib.unsafeFrom(context.totalCollateral)
            // assets pending claim (use latest global assets before withdrawal for redeemability)
            .unsafeSub(context.global.assets.add(withdrawal))
            // assets pending deposit
            .unsafeSub(context.global.deposit.sub(deposit));

        return redemptionEligible
            // approximate assets up for redemption
            .mul(context.global.redemption.unsafeDiv(context.global.shares.add(context.global.redemption)))
            // assets pending claim (use new global assets after withdrawal for eligability)
            .add(context.global.assets);
            // assets pending deposit are eligible for allocation
    }

    /// @notice Adjusts the position on `market` to `targetPosition`
    /// @param registration The registration of the market to use
    /// @param target The new state to target
    /// @param shouldRebalance Whether to rebalance the vault's position
    function _retarget(
        Registration memory registration,
        Target memory target,
        bool shouldRebalance
    ) private {
        registration.market.update(
            address(this),
            shouldRebalance ? target.maker : Fixed6Lib.ZERO,
            shouldRebalance ? target.taker : Fixed6Lib.ZERO,
            target.collateral,
            address(0)
        );
    }

    /// @notice Loads the context for the given `account`
    /// @param account Account to load the context for
    /// @return context The context
    function _loadContext(address account) private view returns (Context memory context) {
        context.parameter = _parameter.read();

        context.latestTimestamp = type(uint256).max;
        context.currentTimestamp = type(uint256).max;
        context.registrations = new Registration[](totalMarkets);
        context.collaterals = new Fixed6[](totalMarkets);

        for (uint256 marketId; marketId < totalMarkets; marketId++) {
            // parameter
            Registration memory registration = _registrations[marketId].read();
            context.registrations[marketId] = registration;

            // version
            (OracleVersion memory oracleVersion, uint256 currentTimestamp) = registration.market.oracle().status();
            context.latestTimestamp = Math.min(context.latestTimestamp, oracleVersion.timestamp);
            if (context.currentTimestamp == type(uint256).max) context.currentTimestamp = currentTimestamp;
            else if (currentTimestamp != context.currentTimestamp) revert VaultCurrentOutOfSyncError();

            // local
            Local memory local = registration.market.locals(address(this));
            context.collaterals[marketId] = local.collateral;
            context.totalCollateral = context.totalCollateral.add(local.collateral);
        }

        if (account != address(0)) context.local = _accounts[account].read();
        context.global = _accounts[address(0)].read();
        context.latestCheckpoint = _checkpoints[context.global.latest].read();
        context.mark = mark;
    }

    /// @notice Saves the context into storage
    /// @param context Context to use
    /// @param account Account to save the context for
    function _saveContext(Context memory context, address account) private {
        if (account != address(0)) _accounts[account].store(context.local);
        _accounts[address(0)].store(context.global);
        _checkpoints[context.currentId].store(context.currentCheckpoint);
        mark = context.mark;
    }

    /// @notice The maximum available deposit amount
    /// @param context Context to use in calculation
    /// @return Maximum available deposit amount
    function _maxDeposit(Context memory context) private view returns (UFixed6) {
        return context.latestCheckpoint.unhealthy() ?
            UFixed6Lib.ZERO :
            context.parameter.maxDeposit.unsafeSub(UFixed6Lib.unsafeFrom(totalAssets()).add(context.global.deposit));
    }

    /// @notice Returns the aggregate perennial checkpoint for the vault at position
    /// @param context Context to use
    /// @param timestamp The timestamp to use
    /// @return checkpoint The checkpoint at the given position
    function _checkpointAtId(
        Context memory context,
        uint256 timestamp
    ) public view returns (PerennialCheckpoint memory checkpoint) {
        for (uint256 marketId; marketId < context.registrations.length; marketId++) {
            PerennialCheckpoint memory marketCheckpoint = context.registrations[marketId].market
                .checkpoints(address(this), timestamp);

            (checkpoint.collateral, checkpoint.tradeFee, checkpoint.settlementFee) = (
                checkpoint.collateral.add(marketCheckpoint.collateral),
                checkpoint.tradeFee.add(marketCheckpoint.tradeFee),
                checkpoint.settlementFee.add(marketCheckpoint.settlementFee)
            );
        }
    }
}
