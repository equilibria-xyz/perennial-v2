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

    /// @dev The token that incentive rewards are paid in
    Token18 private _reward;

    /// @dev The oracle that provides the market price
    IOracleProvider public oracle;

    /// @dev The payoff function over the underlying oracle
    IPayoffProvider public payoff;

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

    /// @dev The global pending versions for each id
    mapping(uint256 => PositionStorageGlobal) private _pendingPosition;

    /// @dev Current local state of each account
    mapping(address => LocalStorage) private _locals;

    /// @dev Current local position of each account
    mapping(address => PositionStorageLocal) private _positions;

    /// @dev The local pending versions for each id for each account
    mapping(address => mapping(uint256 => PositionStorageLocal)) private _pendingPositions;

    /// @dev The historical version accumulator data for each accessed version
    mapping(uint256 => VersionStorage) private _versions;

    /// @notice Initializes the contract state
    /// @param definition_ The market definition
    function initialize(IMarket.MarketDefinition calldata definition_) external initializer(1) {
        __Instance__initialize();
        __ReentrancyGuard__initialize();

        token = definition_.token;
        oracle = definition_.oracle;
        payoff = definition_.payoff;
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

        _parameter.validateAndStore(newParameter, IMarketFactory(address(factory())).parameter(), _reward);
        emit ParameterUpdated(newParameter);
    }

    /// @notice Updates the risk parameter set of the market
    /// @param newRiskParameter The new risk parameter set
    function updateRiskParameter(RiskParameter memory newRiskParameter) external onlyCoordinator {
        _riskParameter.validateAndStore(newRiskParameter, IMarketFactory(address(factory())).parameter());
        emit RiskParameterUpdated(newRiskParameter);
    }

    /// @notice Claims any available fee that the sender has accrued
    /// @dev Applicable fees include: protocol, oracle, risk, and donation
    function claimFee() external {
        Global memory newGlobal = _global.read();

        if (_claimFee(factory().owner(), newGlobal.protocolFee)) newGlobal.protocolFee = UFixed6Lib.ZERO;
        if (_claimFee(address(IMarketFactory(address(factory())).oracleFactory()), newGlobal.oracleFee))
            newGlobal.oracleFee = UFixed6Lib.ZERO;
        if (_claimFee(coordinator, newGlobal.riskFee)) newGlobal.riskFee = UFixed6Lib.ZERO;
        if (_claimFee(beneficiary, newGlobal.donation)) newGlobal.donation = UFixed6Lib.ZERO;

        _global.store(newGlobal);
    }

    /// @notice Helper function to handle a singular fee claim.
    /// @param receiver The address to receive the fee
    /// @param fee The amount of the fee to claim
    function _claimFee(address receiver, UFixed6 fee) private returns (bool) {
        if (msg.sender != receiver) return false;

        token.push(receiver, UFixed18Lib.from(fee));
        emit FeeClaimed(receiver, fee);
        return true;
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

    /// @notice Returns the global pending position for the given id
    /// @param id The id to query
    function pendingPosition(uint256 id) external view returns (Position memory) {
        return _pendingPosition[id].read();
    }

    /// @notice Returns the local pending position for the given account and id
    /// @param account The account to query
    /// @param id The id to query
    function pendingPositions(address account, uint256 id) external view returns (Position memory) {
        return _pendingPositions[account][id].read();
    }

    /// @notice Loads the specified global pending position from state and adjusts it
    /// @param context The context to use
    /// @param id The position id to load
    /// @return newPendingPosition The loaded and global adjusted position
    function _loadPendingPositionGlobal(
        Context memory context,
        uint256 id
    ) private view returns (Position memory newPendingPosition) {
        newPendingPosition = _pendingPosition[id].read();
        newPendingPosition.adjust(context.latestPosition.global);
    }

    /// @notice Loads the specified local pending position from state and adjusts it
    /// @param context The context to use
    /// @param id The position id to load
    /// @return newPendingPosition The loaded and local adjusted position
    function _loadPendingPositionLocal(
        Context memory context,
        address account,
        uint256 id
    ) private view returns (Position memory newPendingPosition) {
        newPendingPosition = _pendingPositions[account][id].read();
        newPendingPosition.adjust(context.latestPosition.local);
    }

    /// @notice Loads the context information of a pending position
    /// @dev Must process pending position in order from latest + 1 to current (post update)
    /// @param context The context to use
    /// @param newPendingPosition The pending position to process
    function _processPendingPosition(Context memory context, Position memory newPendingPosition) private pure {
        // apply pending fees to collateral
        context.pendingCollateral = context.pendingCollateral
            .sub(newPendingPosition.fee)
            .sub(Fixed6Lib.from(newPendingPosition.keeper));

        // measure pending position deltas
        if (context.previousPendingMagnitude.gt(newPendingPosition.magnitude())) {
            context.pendingClose = context.pendingClose
                .add(context.previousPendingMagnitude.sub(newPendingPosition.magnitude()));
        } else {
            context.pendingOpen = context.pendingOpen
                .add(newPendingPosition.magnitude().sub(context.previousPendingMagnitude));
        }
        context.previousPendingMagnitude = newPendingPosition.magnitude();
    }

    /// @notice Loads the context for the update process
    /// @param context The context to load to
    /// @param account The account to query
    function _loadUpdateContext(Context memory context, address account) private view {
        // load latest position
        context.pendingCollateral = context.local.collateral;
        context.previousPendingMagnitude = context.latestPosition.local.magnitude();

        // load current position
        context.currentPosition.global = _loadPendingPositionGlobal(context, context.global.currentId);
        context.currentPosition.global.invalidation.update(context.latestPosition.global.invalidation);
        context.currentPosition.local = _loadPendingPositionLocal(context, account, context.local.currentId);
        context.currentPosition.local.invalidation.update(context.latestPosition.local.invalidation);

        // advance to next id if applicable
        if (context.currentTimestamp > context.currentPosition.local.timestamp) {
            context.local.currentId++;
            context.currentPosition.local.prepare();
        }
        if (context.currentTimestamp > context.currentPosition.global.timestamp) {
            context.global.currentId++;
            context.currentPosition.global.prepare();
        }

        // load pending positions
        for (uint256 id = context.local.latestId + 1; id < context.local.currentId; id++)
            _processPendingPosition(context, _loadPendingPositionLocal(context, account, id));
        context.pendingCollateral = context.pendingCollateral
            .sub(Fixed6Lib.from(context.local.pendingLiquidationFee(context.latestPosition.local)));
    }

    /// @notice Modifies the collateral input per magic values
    /// @param context The context to use
    /// @param collateral The collateral to process
    /// @return The resulting collateral value
    function _processCollateralMagicValue(Context memory context, Fixed6 collateral) private pure returns (Fixed6) {
        if (collateral.eq(MAGIC_VALUE_WITHDRAW_ALL_COLLATERAL))
            return context.local.collateral.mul(Fixed6Lib.NEG_ONE);
        return collateral;
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
            UFixed6 closable = context.latestPosition.local.magnitude().sub(context.pendingClose);
            return context.previousPendingMagnitude.sub(closable.min(context.previousPendingMagnitude));
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

        // update position
        Order memory newOrder =
            context.currentPosition.local.update(context.currentTimestamp, newMaker, newLong, newShort);
        context.currentPosition.global.update(context.currentTimestamp, newOrder, context.riskParameter);

        // update fee
        newOrder.registerFee(context.latestVersion, context.marketParameter, context.riskParameter);
        context.currentPosition.local.registerFee(newOrder);
        context.currentPosition.global.registerFee(newOrder);

        // update collateral
        context.local.update(collateral);
        context.currentPosition.local.update(collateral);
        context.pendingCollateral = context.pendingCollateral.add(collateral);

        // process current position
        _processPendingPosition(context, context.currentPosition.local);

        // protect account
        bool protected = context.local.protect(
            context.riskParameter,
            context.latestVersion,
            context.currentTimestamp,
            newOrder,
            msg.sender,
            protect
        );

        // request version
        if (!newOrder.isEmpty()) oracle.request(IMarket(this), account);

        // after
        _invariant(context, account, newOrder, collateral, protected);

        // store
        _pendingPosition[context.global.currentId].store(context.currentPosition.global);
        _pendingPositions[account][context.local.currentId].store(context.currentPosition.local);

        // fund
        if (collateral.sign() == 1) token.pull(msg.sender, UFixed18Lib.from(collateral.abs()));
        if (collateral.sign() == -1) token.push(msg.sender, UFixed18Lib.from(collateral.abs()));

        // events
        emit Updated(msg.sender, account, context.currentTimestamp, newMaker, newLong, newShort, collateral, protect);
        emit OrderCreated(account, context.currentTimestamp, newOrder, collateral);
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
        (context.latestVersion, context.currentTimestamp) = _oracleVersion();
        context.positionVersion = _oracleVersionAtPosition(context, _position.read());
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

        Position memory nextPosition;

        // settle
        while (
            context.global.currentId != context.global.latestId &&
            (nextPosition = _loadPendingPositionGlobal(context, context.global.latestId + 1))
                .ready(context.latestVersion)
        ) _processPositionGlobal(context, context.global.latestId + 1, nextPosition);

        while (
            context.local.currentId != context.local.latestId &&
            (nextPosition = _loadPendingPositionLocal(context, account, context.local.latestId + 1))
                .ready(context.latestVersion)
        ) {
            Fixed6 previousDelta = _pendingPositions[account][context.local.latestId].read().delta;
            _processPositionLocal(context, account, context.local.latestId + 1, nextPosition);
            _checkpointCollateral(context, account, previousDelta, nextPosition);
        }

        // sync
        if (context.latestVersion.timestamp > context.latestPosition.global.timestamp) {
            nextPosition = _loadPendingPositionGlobal(context, context.global.latestId);
            nextPosition.sync(context.latestVersion);
            _processPositionGlobal(context, context.global.latestId, nextPosition);
        }

        if (context.latestVersion.timestamp > context.latestPosition.local.timestamp) {
            nextPosition = _loadPendingPositionLocal(context, account, context.local.latestId);
            nextPosition.sync(context.latestVersion);
            _processPositionLocal(context, account, context.local.latestId, nextPosition);
        }

        // overwrite latestPrice if invalid
        context.latestVersion.price = context.global.latestPrice;

        _position.store(context.latestPosition.global);
        _positions[account].store(context.latestPosition.local);
    }

    /// @notice Places a collateral checkpoint for the account on the given pending position
    /// @param context The context to use
    /// @param account The account to checkpoint for
    /// @param previousDelta The previous pending position's delta value
    /// @param nextPosition The next pending position
    function _checkpointCollateral(
        Context memory context,
        address account,
        Fixed6 previousDelta,
        Position memory nextPosition
    ) private {
        Position memory latestAccountPosition = _pendingPositions[account][context.local.latestId].read();
        Position memory currentAccountPosition = _pendingPositions[account][context.local.currentId].read();
        latestAccountPosition.collateral = context.local.collateral
            .sub(currentAccountPosition.delta.sub(previousDelta))                       // deposits happen after snapshot point
            .add(nextPosition.fee)                                                      // position fee happens after snapshot point
            .add(Fixed6Lib.from(nextPosition.keeper))                                   // keeper fee happens after snapshot point
            .add(Fixed6Lib.from(context.local.pendingLiquidationFee(nextPosition)));    // liquidation fee happens after snapshot point
        _pendingPositions[account][context.local.latestId].store(latestAccountPosition);
    }

    /// @notice Processes the given global pending position into the latest position
    /// @param context The context to use
    /// @param newPositionId The id of the pending position to process
    /// @param newPosition The pending position to process
    function _processPositionGlobal(Context memory context, uint256 newPositionId, Position memory newPosition) private {
        Version memory version = _versions[context.latestPosition.global.timestamp].read();
        OracleVersion memory oracleVersion = _oracleVersionAtPosition(context, newPosition);

        if (!oracleVersion.valid) context.latestPosition.global.invalidate(newPosition);

        (uint256 fromTimestamp, uint256 fromId) = (context.latestPosition.global.timestamp, context.global.latestId);
        (VersionAccumulationResult memory accumulationResult, UFixed6 accumulatedFee) = version.accumulate(
            context.global,
            context.latestPosition.global,
            newPosition,
            context.positionVersion,
            oracleVersion,
            context.marketParameter,
            context.riskParameter
        );
        context.latestPosition.global.update(newPosition);
        context.global.update(newPositionId, oracleVersion.price);
        context.global.incrementFees(
            accumulatedFee,
            newPosition.keeper,
            context.marketParameter,
            context.protocolParameter
        );
        context.positionVersion = oracleVersion;
        _versions[newPosition.timestamp].store(version);

        // events
        emit PositionProcessed(
            fromTimestamp,
            newPosition.timestamp,
            fromId,
            newPositionId,
            accumulationResult
        );
    }

    /// @notice Processes the given local pending position into the latest position
    /// @param context The context to use
    /// @param account The account to process for
    /// @param newPositionId The id of the pending position to process
    /// @param newPosition The pending position to process
    function _processPositionLocal(
        Context memory context,
        address account,
        uint256 newPositionId,
        Position memory newPosition
    ) private {
        Version memory version = _versions[newPosition.timestamp].read();
        if (!version.valid) context.latestPosition.local.invalidate(newPosition);

        (uint256 fromTimestamp, uint256 fromId) = (context.latestPosition.local.timestamp, context.local.latestId);
        LocalAccumulationResult memory accumulationResult = context.local.accumulate(
            newPositionId,
            context.latestPosition.local,
            newPosition,
            _versions[context.latestPosition.local.timestamp].read(),
            version
        );
        context.latestPosition.local.update(newPosition);
        if (context.local.processProtection(newPosition, version)) {
            Local memory localInitiator = _locals[context.local.protectionInitiator].read();
            localInitiator.processLiquidationFee(context.local);
            _locals[context.local.protectionInitiator].store(localInitiator);
        }

        // events
        emit AccountPositionProcessed(
            account,
            fromTimestamp,
            newPosition.timestamp,
            fromId,
            newPositionId,
            accumulationResult
        );
    }

    /// @notice Verifies the invariant of the market
    /// @param context The context to use
    /// @param account The account to verify the invariant for
    /// @param newOrder The order to verify the invariant for
    /// @param collateral The collateral change to verify the invariant for
    /// @param protected Whether the new position is protected
    function _invariant(
        Context memory context,
        address account,
        Order memory newOrder,
        Fixed6 collateral,
        bool protected
    ) private view {
        if (context.pendingClose.gt(context.latestPosition.local.magnitude())) revert MarketOverCloseError();

        if (protected && (
            !context.pendingClose.eq(context.latestPosition.local.magnitude()) ||
            context.latestPosition.local.maintained(
                context.latestVersion,
                context.riskParameter,
                context.pendingCollateral.sub(collateral)
            ) ||
            collateral.lt(Fixed6Lib.ZERO) ||
            newOrder.maker.add(newOrder.long).add(newOrder.short).gte(Fixed6Lib.ZERO)
        )) revert MarketInvalidProtectionError();

        if (
            !(context.currentPosition.local.magnitude().isZero() && context.latestPosition.local.magnitude().isZero()) &&   // sender has no position
            !(newOrder.isEmpty() && collateral.gte(Fixed6Lib.ZERO)) &&                                                      // sender is depositing zero or more into account, without position change
            (context.currentTimestamp - context.latestVersion.timestamp >= context.riskParameter.staleAfter)                // price is not stale
        ) revert MarketStalePriceError();

        if (context.marketParameter.closed && newOrder.increasesPosition())
            revert MarketClosedError();

        if (
            context.currentPosition.global.maker.gt(context.riskParameter.makerLimit) &&
            newOrder.maker.gt(Fixed6Lib.ZERO)
        ) revert MarketMakerOverLimitError();

        if (!newOrder.singleSided(context.currentPosition.local) || !newOrder.singleSided(context.latestPosition.local))
            revert MarketNotSingleSidedError();

        if (protected) return; // The following invariants do not apply to protected position updates (liquidations)

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
            !context.currentPosition.local.margined(context.latestVersion, context.riskParameter, context.pendingCollateral)
        ) revert MarketInsufficientMarginError();

        if (
            !PositionLib.margined(
                context.latestPosition.local.magnitude().add(context.pendingOpen),
                context.latestVersion,
                context.riskParameter,
                context.pendingCollateral
            )
        ) revert MarketInsufficientMarginError();

        if (
            (context.local.protection > context.latestPosition.local.timestamp) &&
            !newOrder.isEmpty()
        ) revert MarketProtectedError();

        if (
            newOrder.liquidityCheckApplicable(context.marketParameter) &&
            newOrder.efficiency.lt(Fixed6Lib.ZERO) &&
            context.currentPosition.global.efficiency().lt(context.riskParameter.efficiencyLimit)
        ) revert MarketEfficiencyUnderLimitError();

        if (
            newOrder.liquidityCheckApplicable(context.marketParameter) &&
            context.currentPosition.global.socialized() &&
            newOrder.decreasesLiquidity()
        ) revert MarketInsufficientLiquidityError();

        if (collateral.lt(Fixed6Lib.ZERO) && context.pendingCollateral.lt(Fixed6Lib.ZERO))
            revert MarketInsufficientCollateralError();
    }

    /// @notice Computes the current oracle status with the market's payoff
    /// @return latestVersion The latest oracle version with payoff applied
    /// @return currentTimestamp The current oracle timestamp
    function _oracleVersion() private view returns (OracleVersion memory latestVersion, uint256 currentTimestamp) {
        (latestVersion, currentTimestamp) = oracle.status();
        _transform(latestVersion);
    }

    /// @notice Computes the latest oracle version at a given timestamp with the market's payoff
    /// @param timestamp The timestamp to use
    /// @return oracleVersion The oracle version at the given timestamp with payoff applied
    function _oracleVersionAt(uint256 timestamp) private view returns (OracleVersion memory oracleVersion) {
        oracleVersion = oracle.at(timestamp);
        _transform(oracleVersion);
    }

    /// @notice Computes the latest oracle version at a given position with the market's payoff
    /// @dev applies the latest valid price when the version at position is invalid
    /// @param context The context to use
    /// @param toPosition The position to use
    /// @return oracleVersion The oracle version at the given position
    function _oracleVersionAtPosition(
        Context memory context,
        Position memory toPosition
    ) private view returns (OracleVersion memory oracleVersion) {
        oracleVersion = _oracleVersionAt(toPosition.timestamp);
        if (!oracleVersion.valid) oracleVersion.price = context.global.latestPrice;
    }

    /// @notice Applies the market's payoff to an oracle version
    /// @param oracleVersion The oracle version to transform
    function _transform(OracleVersion memory oracleVersion) private view {
        if (address(payoff) != address(0)) oracleVersion.price = payoff.payoff(oracleVersion.price);
    }

    /// @notice Only the coordinator or the owner can call
    modifier onlyCoordinator {
        if (msg.sender != coordinator && msg.sender != factory().owner()) revert MarketNotCoordinatorError();
        _;
    }
}
