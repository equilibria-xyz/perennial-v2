// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.19;

import "@equilibria/root/attribute/Instance.sol";
import "@equilibria/root/attribute/ReentrancyGuard.sol";
import "./interfaces/IMarket.sol";
import "./interfaces/IMarketFactory.sol";

/// @title Market
/// @notice Manages logic and state for a single market.
/// @dev Cloned by the Factory contract to launch new markets.
contract Market is IMarket, Instance, ReentrancyGuard {
    Fixed6 private constant MAGIC_VALUE_WITHDRAW_ALL_COLLATERAL = Fixed6.wrap(type(int256).min);
    UFixed6 private constant MAGIC_VALUE_UNCHANGED_POSITION = UFixed6.wrap(type(uint256).max);
    UFixed6 private constant MAGIC_VALUE_FULLY_CLOSED_POSITION = UFixed6.wrap(type(uint256).max - 1);

    /// @dev The underlying token that the market settles in
    Token18 public token;

    /// @dev DEPRECATED SLOT -- previously the reward token
    bytes32 private __unused0__;

    /// @dev The oracle that provides the market price
    IOracleProvider public oracle;

    /// @dev DEPRECATED SLOT -- previously the payoff provider
    bytes32 private __unused1__;

    /// @dev Beneficiary of the market, receives donations
    address private beneficiary;

    /// @dev Risk coordinator of the market
    address private coordinator;

    /// @dev Risk parameters of the market
    RiskParameterStorage private _riskParameter;

    /// @dev Parameters of the market
    MarketParameterStorage private _parameter;

    /// @dev Current global state of the market
    GlobalStorage private _global;

    /// @dev Current global position of the market
    PositionStorageGlobal private _position;

    /// @dev DEPRECATED SLOT -- previously the global pending positions
    bytes32 private __unused2__;

    /// @dev Current local state of each account
    mapping(address => LocalStorage) private _locals;

    /// @dev Current local position of each account
    mapping(address => PositionStorageLocal) private _positions;

    /// @dev DEPRECATED SLOT -- previously the local pending positions
    bytes32 private __unused3__;

    /// @dev The historical version accumulator data for each accessed version
    mapping(uint256 => VersionStorage) private _versions;

    /// @dev The global pending order for each id
    mapping(uint256 => OrderStorageGlobal) private _pendingOrder;

    /// @dev The local pending order for each id for each account
    mapping(address => mapping(uint256 => OrderStorageLocal)) private _pendingOrders;

    /// @dev The global aggregate pending order
    OrderStorageGlobal private _pending;

    /// @dev The local aggregate pending order for each account
    mapping(address => OrderStorageLocal) private _pendings;

    /// @dev The local checkpoint for each id for each account
    mapping(address => mapping(uint256 => CheckpointStorage)) private _checkpoints;

    /// @dev The liquidator for each id for each account
    mapping(address => mapping(uint256 => address)) public liquidators;

    /// @notice Initializes the contract state
    /// @param definition_ The market definition
    function initialize(IMarket.MarketDefinition calldata definition_) external initializer(1) {
        __Instance__initialize();
        __ReentrancyGuard__initialize();

        token = definition_.token;
        oracle = definition_.oracle;
    }

    /// @notice Updates the account's position and collateral
    /// @param account The account to operate on
    /// @param newMaker The new maker position for the account
    /// @param newMaker The new long position for the account
    /// @param newMaker The new short position for the account
    /// @param collateral The collateral amount to add or remove from the account
    /// @param protect Whether to put the account into a protected status for liquidations
    function update(
        address account,
        UFixed6 newMaker,
        UFixed6 newLong,
        UFixed6 newShort,
        Fixed6 collateral,
        bool protect
    ) external nonReentrant whenNotPaused {
        Context memory context = _loadContext(account);
        _settle(context, account);
        _update(context, account, newMaker, newLong, newShort, collateral, protect);
        _saveContext(context, account);
    }

    /// @notice Updates the beneficiary, coordinator, and parameter set of the market
    /// @param newBeneficiary The new beneficiary address
    /// @param newCoordinator The new coordinator address
    /// @param newParameter The new parameter set
    function updateParameter(
        address newBeneficiary,
        address newCoordinator,
        MarketParameter memory newParameter
    ) external onlyOwner {
        beneficiary = newBeneficiary;
        emit BeneficiaryUpdated(newBeneficiary);

        coordinator = newCoordinator;
        emit CoordinatorUpdated(newCoordinator);

        _parameter.validateAndStore(newParameter, IMarketFactory(address(factory())).parameter());
        emit ParameterUpdated(newParameter);
    }

    /// @notice Updates the risk parameter set of the market
    /// @param newRiskParameter The new risk parameter set
    function updateRiskParameter(RiskParameter memory newRiskParameter) external onlyCoordinator {

        // credit impact update fee to the protocol account
        Global memory newGlobal = _global.read();
        Position memory latestPosition = _position.read();
        RiskParameter memory latestRiskParameter = _riskParameter.read();
        OracleVersion memory latestVersion = oracle.at(latestPosition.timestamp);

        Fixed6 updateFee = latestRiskParameter.makerFee
            .update(newRiskParameter.makerFee, latestPosition.maker, latestVersion.price.abs())
            .add(latestRiskParameter.takerFee
                .update(newRiskParameter.takerFee, latestPosition.skew(), latestVersion.price.abs()));

        newGlobal.exposure = newGlobal.exposure.sub(updateFee);
        _global.store(newGlobal);
        
        // update 
        _riskParameter.validateAndStore(newRiskParameter, IMarketFactory(address(factory())).parameter());
        emit RiskParameterUpdated(newRiskParameter);
    }

    /// @notice Claims any available fee that the sender has accrued
    /// @dev Applicable fees include: protocol, oracle, risk, donation, and claimable
    function claimFee() external {
        Global memory newGlobal = _global.read();
        Local memory newLocal = _locals[msg.sender].read();

        if (_claimFee(factory().owner(), newGlobal.protocolFee)) newGlobal.protocolFee = UFixed6Lib.ZERO;
        if (_claimFee(address(IMarketFactory(address(factory())).oracleFactory()), newGlobal.oracleFee))
            newGlobal.oracleFee = UFixed6Lib.ZERO;
        if (_claimFee(coordinator, newGlobal.riskFee)) newGlobal.riskFee = UFixed6Lib.ZERO;
        if (_claimFee(beneficiary, newGlobal.donation)) newGlobal.donation = UFixed6Lib.ZERO;
        if (_claimFee(msg.sender, newLocal.claimable)) newLocal.claimable = UFixed6Lib.ZERO;

        _global.store(newGlobal);
        _locals[msg.sender].store(newLocal);
    }

    /// @notice Settles any exposure that has accrued to the market
    /// @dev Resets exposure to zero, caller pays or receives to net out the exposure
    function claimExposure() external onlyOwner {
        Global memory newGlobal = _global.read();

        if (newGlobal.exposure.sign() == 1) token.push(msg.sender, UFixed18Lib.from(newGlobal.exposure.abs()));
        if (newGlobal.exposure.sign() == -1) token.pull(msg.sender, UFixed18Lib.from(newGlobal.exposure.abs()));
        
        emit ExposureClaimed(msg.sender, newGlobal.exposure);

        newGlobal.exposure = Fixed6Lib.ZERO;
        _global.store(newGlobal);
    }

    /// @notice Helper function to handle a singular fee claim.
    /// @param receiver The address to receive the fee
    /// @param fee The amount of the fee to claim
    function _claimFee(address receiver, UFixed6 fee) private returns (bool) {
        if (msg.sender != receiver || fee.isZero()) return false;

        token.push(receiver, UFixed18Lib.from(fee));
        emit FeeClaimed(receiver, fee);
        return true;
    }

    /// @notice Returns the payoff provider
    /// @dev For backwards compatibility
    function payoff() external pure returns (address) {
        return address(0);
    }

    /// @notice Returns the current parameter set
    function parameter() external view returns (MarketParameter memory) {
        return _parameter.read();
    }

    /// @notice Returns the current risk parameter set
    function riskParameter() external view returns (RiskParameter memory) {
        return _riskParameter.read();
    }

    /// @notice Returns the current global position
    function position() external view returns (Position memory) {
        return _position.read();
    }

    /// @notice Returns the current local position for the account
    /// @param account The account to query
    function positions(address account) external view returns (Position memory) {
        return _positions[account].read();
    }

    /// @notice Returns the current global state
    function global() external view returns (Global memory) {
        return _global.read();
    }

    /// @notice Returns the historical version snapshot at the given timestamp
    /// @param timestamp The timestamp to query
    function versions(uint256 timestamp) external view returns (Version memory) {
        return _versions[timestamp].read();
    }

    /// @notice Returns the local state for the given account
    /// @param account The account to query
    function locals(address account) external view returns (Local memory) {
        return _locals[account].read();
    }

    /// @notice Returns the global pending order for the given id
    /// @param id The id to query
    function pendingOrder(uint256 id) external view returns (Order memory) {
        return _pendingOrder[id].read();
    }

    /// @notice Returns the local pending order for the given account and id
    /// @param account The account to query
    /// @param id The id to query
    function pendingOrders(address account, uint256 id) external view returns (Order memory) {
        return _pendingOrders[account][id].read();
    }

    /// @notice Returns the aggregate global pending order
    function pending() external view returns (Order memory) {
        return _pending.read();
    }

    /// @notice Returns the aggregate local pending order for the given account
    /// @param account The account to query
    function pendings(address account) external view returns (Order memory) {
        return _pendings[account].read();
    }

    /// @notice Returns the local checkpoint for the given account and version
    /// @param account The account to query
    /// @param version The version to query
    function checkpoints(address account, uint256 version) external view returns (Checkpoint memory) {
        return _checkpoints[account][version].read();
    }

    /// @notice Loads the context for the update process
    /// @param context The context to load to
    /// @param account The account to query
    function _loadUpdateContext(Context memory context, address account) private view {
        // load current order
        context.order.global = _pendingOrder[context.global.currentId].read();
        context.order.local = _pendingOrders[account][context.local.currentId].read();
        context.pending.global = _pending.read();
        context.pending.local = _pendings[account].read();

        // advance to next id if applicable
        if (context.currentTimestamp > context.order.local.timestamp) {
            context.order.local.next(context.currentTimestamp);
            context.local.currentId++;
        }
        if (context.currentTimestamp > context.order.global.timestamp) {
            context.order.global.next(context.currentTimestamp);
            context.global.currentId++;
        }

        // load current position
        context.currentPosition.global = context.latestPosition.global.clone();
        context.currentPosition.global.update(context.pending.global, true);
        context.currentPosition.local = context.latestPosition.local.clone();
        context.currentPosition.local.update(context.pending.local, true);
    }

    /// @notice Modifies the collateral input per magic values
    /// @param context The context to use
    /// @param collateral The collateral to process
    /// @return The resulting collateral value
    function _processCollateralMagicValue(Context memory context, Fixed6 collateral) private pure returns (Fixed6) {
        return collateral.eq(MAGIC_VALUE_WITHDRAW_ALL_COLLATERAL) ?
            context.local.collateral.mul(Fixed6Lib.NEG_ONE) :
            collateral;
    }

    /// @notice Modifies the position input per magic values
    /// @param context The context to use
    /// @param currentPosition The current position prior to update
    /// @param newPosition The position to process
    /// @return The resulting position value
    function _processPositionMagicValue(
        Context memory context,
        UFixed6 currentPosition,
        UFixed6 newPosition
    ) private pure returns (UFixed6) {
        if (newPosition.eq(MAGIC_VALUE_UNCHANGED_POSITION))
            return currentPosition;
        if (newPosition.eq(MAGIC_VALUE_FULLY_CLOSED_POSITION)) {
            if (currentPosition.isZero()) return currentPosition;
            return currentPosition.sub(context.latestPosition.local.magnitude().sub(context.pending.local.neg()));
        }
        return newPosition;
    }

    /// @notice Updates the current position
    /// @param context The context to use
    /// @param account The account to update
    /// @param newMaker The new maker position size
    /// @param newLong The new long position size
    /// @param newShort The new short position size
    /// @param collateral The change in collateral
    /// @param protect Whether to protect the position for liquidation
    function _update(
        Context memory context,
        address account,
        UFixed6 newMaker,
        UFixed6 newLong,
        UFixed6 newShort,
        Fixed6 collateral,
        bool protect
    ) private {
        // load
        _loadUpdateContext(context, account);

        // magic values
        collateral = _processCollateralMagicValue(context, collateral);
        newMaker = _processPositionMagicValue(context, context.currentPosition.local.maker, newMaker);
        newLong = _processPositionMagicValue(context, context.currentPosition.local.long, newLong);
        newShort = _processPositionMagicValue(context, context.currentPosition.local.short, newShort);

        // update current position
        Order memory newOrder = OrderLib.from(
            context.currentTimestamp,
            context.currentPosition.local,
            collateral,
            newMaker,
            newLong,
            newShort,
            protect
        );
        context.currentPosition.global.update(newOrder, true);
        context.currentPosition.local.update(newOrder, true);

        // apply new order
        context.order.local.add(newOrder);
        context.order.global.add(newOrder);
        context.pending.global.add(newOrder);
        context.pending.local.add(newOrder);

        // update collateral
        context.local.update(collateral);

        // protect account
        if (newOrder.protected()) liquidators[account][context.local.currentId] = msg.sender;

        // request version
        if (!newOrder.isEmpty()) oracle.request(IMarket(this), account);

        // after
        _invariant(context, account, newOrder, collateral);

        // store
        _pendingOrder[context.global.currentId].store(context.order.global);
        _pendingOrders[account][context.local.currentId].store(context.order.local);
        _pending.store(context.pending.global);
        _pendings[account].store(context.pending.local);

        // fund
        if (collateral.sign() == 1) token.pull(msg.sender, UFixed18Lib.from(collateral.abs()));
        if (collateral.sign() == -1) token.push(msg.sender, UFixed18Lib.from(collateral.abs()));

        // events
        emit Updated(msg.sender, account, context.currentTimestamp, newMaker, newLong, newShort, collateral, protect);
        emit OrderCreated(account, newOrder);
    }

    /// @notice Loads the context of the transaction
    /// @param account The account to load the context of
    /// @return context The loaded context
    function _loadContext(address account) private view returns (Context memory context) {
        // parameters
        context.protocolParameter = IMarketFactory(address(factory())).parameter();
        context.marketParameter = _parameter.read();
        context.riskParameter = _riskParameter.read();

        // state
        context.global = _global.read();
        context.local = _locals[account].read();

        // oracle
        (context.latestOracleVersion, context.currentTimestamp) = oracle.status();
        context.orderOracleVersion = oracle.at(_position.read().timestamp);
    }

    /// @notice Stores the given context
    /// @param context The context to store
    /// @param account The account to store for
    function _saveContext(Context memory context, address account) private {
        _global.store(context.global);
        _locals[account].store(context.local);
    }

    /// @notice Settles the account position up to the latest version
    /// @param context The context to use
    /// @param account The account to settle
    function _settle(Context memory context, address account) private {
        context.latestPosition.global = _position.read();
        context.latestPosition.local = _positions[account].read();
        context.pending.global = _pending.read();
        context.pending.local = _pendings[account].read();
        context.latestVersion = _versions[context.latestPosition.global.timestamp].read();
        context.latestCheckpoint = _checkpoints[account][context.latestPosition.local.timestamp].read();

        Order memory nextOrder;

        // settle
        while (
            context.global.currentId != context.global.latestId &&
            (nextOrder = _pendingOrder[context.global.latestId + 1].read()).ready(context.latestOracleVersion)
        ) _processOrderGlobal(context, context.global.latestId + 1, nextOrder);

        while (
            context.local.currentId != context.local.latestId &&
            (nextOrder = _pendingOrders[account][context.local.latestId + 1].read()).ready(context.latestOracleVersion)
        ) _processOrderLocal(context, account, context.local.latestId + 1, nextOrder);

        // sync
        if (context.latestOracleVersion.timestamp > context.latestPosition.global.timestamp) {
            nextOrder = _pendingOrder[context.global.latestId].read();
            nextOrder.next(context.latestOracleVersion.timestamp);
            _processOrderGlobal(context, context.global.latestId, nextOrder);
        }

        if (context.latestOracleVersion.timestamp > context.latestPosition.local.timestamp) {
            nextOrder = _pendingOrders[account][context.local.latestId].read();
            nextOrder.next(context.latestOracleVersion.timestamp);
            _processOrderLocal(context, account, context.local.latestId, nextOrder);
        }

        _position.store(context.latestPosition.global);
        _positions[account].store(context.latestPosition.local);
        _pending.store(context.pending.global);
        _pendings[account].store(context.pending.local);
    }

    /// @notice Processes the given global pending position into the latest position
    /// @param context The context to use
    /// @param newOrderId The id of the pending position to process
    /// @param newOrder The pending position to process
    function _processOrderGlobal(Context memory context, uint256 newOrderId, Order memory newOrder) private {
        OracleVersion memory oracleVersion = oracle.at(newOrder.timestamp);
        
        (uint256 fromTimestamp, uint256 fromId) = (context.latestPosition.global.timestamp, context.global.latestId);
        (
            VersionAccumulationResult memory accumulationResult,
            VersionFeeResult memory feeResult
        ) = context.latestVersion.accumulate(
            context.global,
            context.latestPosition.global,
            newOrder,
            context.orderOracleVersion,
            oracleVersion,
            context.marketParameter,
            context.riskParameter
        );

        context.global.update(
            newOrderId,
            feeResult.marketFee,
            feeResult.settlementFee,
            feeResult.protocolFee,
            context.marketParameter,
            context.protocolParameter
        );

        context.latestPosition.global.update(newOrder, oracleVersion.valid);
        context.pending.global.sub(newOrder);

        context.orderOracleVersion = oracleVersion;
        _versions[newOrder.timestamp].store(context.latestVersion);

        emit PositionProcessed(fromTimestamp, newOrder.timestamp, fromId, newOrderId, accumulationResult);
    }

    /// @notice Processes the given local pending position into the latest position
    /// @param context The context to use
    /// @param account The account to process for
    /// @param newOrderId The id of the pending position to process
    /// @param newOrder The pending order to process
    function _processOrderLocal(
        Context memory context,
        address account,
        uint256 newOrderId,
        Order memory newOrder
    ) private {
        Version memory version = _versions[newOrder.timestamp].read();

        (uint256 fromTimestamp, uint256 fromId) = (context.latestPosition.local.timestamp, context.local.latestId);
        CheckpointAccumulationResult memory accumulationResult = context.latestCheckpoint.accumulate(
            newOrder,
            context.latestPosition.local,
            _versions[context.latestPosition.local.timestamp].read(),
            version
        );

        context.local.update(
            newOrderId,
            accumulationResult.collateral,
            accumulationResult.tradeFee,
            accumulationResult.settlementFee,
            accumulationResult.liquidationFee
        );
        _credit(liquidators[account][newOrderId], accumulationResult.liquidationFee);

        context.latestPosition.local.update(newOrder, version.valid);
        context.pending.local.sub(newOrder);

        _checkpoints[account][newOrder.timestamp].store(context.latestCheckpoint);

        emit AccountPositionProcessed(
            account,
            fromTimestamp,
            newOrder.timestamp,
            fromId,
            newOrderId,
            accumulationResult
        );
    }

    /// @notice Credits an account's claimable that is out-of-context
    /// @dev The amount must have already come from a corresponing debit in the settlement flow
    /// @param account The account to credit
    /// @param amount The amount to credit
    function _credit(address account, UFixed6 amount) private {
        if (amount.isZero()) return;

        Local memory newLocal = _locals[account].read();
        newLocal.credit(amount);
        _locals[account].store(newLocal);
    }

    /// @notice Verifies the invariant of the market
    /// @param context The context to use
    /// @param account The account to verify the invariant for
    /// @param newOrder The order to verify the invariant for
    /// @param collateral The collateral change to verify the invariant for
    function _invariant(
        Context memory context,
        address account,
        Order memory newOrder,
        Fixed6 collateral
    ) private view {
        if (context.pending.local.neg().gt(context.latestPosition.local.magnitude())) revert MarketOverCloseError();

        if (newOrder.protected() && (
            !context.pending.local.neg().eq(context.latestPosition.local.magnitude()) ||
            context.latestPosition.local.maintained(
                context.latestOracleVersion,
                context.riskParameter,
                context.local.collateral.sub(collateral)
            ) ||
            collateral.lt(Fixed6Lib.ZERO) ||
            newOrder.magnitude().gte(Fixed6Lib.ZERO)
        )) revert MarketInvalidProtectionError();

        if (
            !(context.currentPosition.local.magnitude().isZero() && context.latestPosition.local.magnitude().isZero()) &&   // sender has no position
            !(newOrder.isEmpty() && collateral.gte(Fixed6Lib.ZERO)) &&                                                      // sender is depositing zero or more into account, without position change
            (context.currentTimestamp - context.latestOracleVersion.timestamp >= context.riskParameter.staleAfter)          // price is not stale
        ) revert MarketStalePriceError();

        if (context.marketParameter.closed && newOrder.increasesPosition())
            revert MarketClosedError();

        if (
            context.currentPosition.global.maker.gt(context.riskParameter.makerLimit) &&
            newOrder.increasesMaker()
        ) revert MarketMakerOverLimitError();

        if (
            !context.currentPosition.local.singleSided() || (
                context.latestPosition.local.direction() != context.currentPosition.local.direction() &&
                    !context.latestPosition.local.empty() &&
                    !context.currentPosition.local.empty()
            )
        ) revert MarketNotSingleSidedError();

        if (newOrder.protected()) return; // The following invariants do not apply to protected position updates (liquidations)

        if (
            msg.sender != account &&                                                        // sender is operating on own account
            !IMarketFactory(address(factory())).operators(account, msg.sender) &&           // sender is operator approved for account
            !(newOrder.isEmpty() && collateral.gte(Fixed6Lib.ZERO))                         // sender is depositing zero or more into account, without position change
        ) revert MarketOperatorNotAllowedError();

        if (
            context.global.currentId > context.global.latestId + context.marketParameter.maxPendingGlobal ||
            context.local.currentId > context.local.latestId + context.marketParameter.maxPendingLocal
        ) revert MarketExceedsPendingIdLimitError();

        if (
            !PositionLib.margined(
                context.latestPosition.local.magnitude().add(context.pending.local.pos()),
                context.latestOracleVersion,
                context.riskParameter,
                context.local.collateral
            )
        ) revert MarketInsufficientMarginError();

        if (context.pending.local.protected() && !newOrder.protected() && !newOrder.isEmpty())
            revert MarketProtectedError();

        if (
            newOrder.liquidityCheckApplicable(context.marketParameter) &&
            newOrder.decreasesEfficiency(context.currentPosition.global) &&
            context.currentPosition.global.efficiency().lt(context.riskParameter.efficiencyLimit)
        ) revert MarketEfficiencyUnderLimitError();

        if (
            newOrder.liquidityCheckApplicable(context.marketParameter) &&
            context.currentPosition.global.socialized() &&
            newOrder.decreasesLiquidity(context.currentPosition.global)
        ) revert MarketInsufficientLiquidityError();

        if (collateral.lt(Fixed6Lib.ZERO) && context.local.collateral.lt(Fixed6Lib.ZERO))
            revert MarketInsufficientCollateralError();
    }

    /// @notice Only the coordinator or the owner can call
    modifier onlyCoordinator {
        if (msg.sender != coordinator && msg.sender != factory().owner()) revert MarketNotCoordinatorError();
        _;
    }
}
