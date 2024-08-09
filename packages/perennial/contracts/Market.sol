// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import "@equilibria/perennial-v2-verifier/contracts/interfaces/IVerifier.sol";
import "@equilibria/root/attribute/Instance.sol";
import "@equilibria/root/attribute/ReentrancyGuard.sol";
import "./interfaces/IMarket.sol";
import "./interfaces/IMarketFactory.sol";
import "./libs/InvariantLib.sol";

/// @title Market
/// @notice Manages logic and state for a single market.
/// @dev Cloned by the Factory contract to launch new markets.
contract Market is IMarket, Instance, ReentrancyGuard {
    Fixed6 private constant MAGIC_VALUE_WITHDRAW_ALL_COLLATERAL = Fixed6.wrap(type(int256).min);
    UFixed6 private constant MAGIC_VALUE_UNCHANGED_POSITION = UFixed6.wrap(type(uint256).max);
    UFixed6 private constant MAGIC_VALUE_FULLY_CLOSED_POSITION = UFixed6.wrap(type(uint256).max - 1);

    IVerifier public immutable verifier;

    /// @dev The underlying token that the market settles in
    Token18 public token;

    /// @dev DEPRECATED SLOT -- previously the reward token
    bytes32 private __unused0__;

    /// @dev The oracle that provides the market price
    IOracleProvider public oracle;

    /// @dev DEPRECATED SLOT -- previously the payoff provider
    bytes32 private __unused1__;

    /// @dev Beneficiary of the market, receives donations
    address public beneficiary;

    /// @dev Risk coordinator of the market
    address public coordinator;

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

    /// @dev The local checkpoint for each version for each account
    mapping(address => mapping(uint256 => CheckpointStorage)) private _checkpoints;

    /// @dev The liquidator for each id for each account
    mapping(address => mapping(uint256 => address)) public liquidators;

    /// @dev The referrer for each id for each account
    mapping(address => mapping(uint256 => address)) public orderReferrers;

    /// @dev The referrer for each id for each account
    mapping(address => mapping(uint256 => address)) public guaranteeReferrers;

    /// @dev The global pending guarantee for each id
    mapping(uint256 => GuaranteeStorageGlobal) private _guarantee;

    /// @dev The local pending guarantee for each id for each account
    mapping(address => mapping(uint256 => GuaranteeStorageLocal)) private _guarantees;

    /// @dev Construct the contract implementation
    /// @param verifier_ The verifier contract to use
    constructor(IVerifier verifier_) {
        verifier = verifier_;
    }

    /// @notice Initializes the contract state
    /// @param definition_ The market definition
    function initialize(IMarket.MarketDefinition calldata definition_) external initializer(1) {
        __Instance__initialize();
        __ReentrancyGuard__initialize();

        token = definition_.token;
        oracle = definition_.oracle;
    }


    /// @notice Syncs the account's position and collateral
    /// @param account The account to operate on
    function sync(address account) external nonReentrant whenNotPaused {
        Context memory context = _loadContext(account);

        _sync(context);

        _storeContext(context);
    }

    /// @notice Settles the account's position and collateral
    /// @param account The account to operate on
    function settle(address account) external nonReentrant whenNotPaused {
        Context memory context = _loadContext(account);

        SettlementContext memory settlementContext = _sync(context);
        _settle(context, settlementContext);

        _storeContext(context);
    }

    /// @notice Updates both the long and short positions of an intent order
    /// @dev - One side is specified in the signed intent, while the sender is assumed to be the counterparty
    ///      - The sender is charged the settlement fee
    /// @param intent The intent that is being filled
    /// @param signature The signature of the intent that is being filled
    function update(Intent calldata intent, bytes memory signature) external nonReentrant whenNotPaused {
        if (intent.fee.gt(UFixed6Lib.ONE)) revert MarketInvalidIntentFeeError();

        verifier.verifyIntent(intent, signature);

        _updateIntent(
            msg.sender,
            address(0),
            intent.amount.mul(Fixed6Lib.NEG_ONE),
            intent.price,
            intent.originator,
            intent.solver,
            intent.fee,
            true
        ); // sender
        _updateIntent(
            intent.common.account,
            intent.common.signer,
            intent.amount,
            intent.price,
            intent.originator,
            intent.solver,
            intent.fee,
            false
        ); // signer
    }

    /// @notice Updates the account's position for an intent order
    /// @param account The account to operate on
    /// @param signer The signer of the order
    /// @param amount The size and direction of the order being opened
    /// @param price The price to execute the order at
    /// @param orderReferrer The referrer of the order
    /// @param guaranteeReferrer The referrer of the guarantee
    /// @param guaranteeReferralFee The referral fee for the guarantee
    /// @param chargeFee Whether to charge the fee
    function _updateIntent(
        address account,
        address signer,
        Fixed6 amount,
        Fixed6 price,
        address orderReferrer,
        address guaranteeReferrer,
        UFixed6 guaranteeReferralFee,
        bool chargeFee
    ) private {
        // settle market & account
        Context memory context = _loadContext(account);
        SettlementContext memory settlementContext = _sync(context);
        _settle(context, settlementContext);

        // load update context
        UpdateContext memory updateContext = _loadUpdateContext(context, signer, orderReferrer, guaranteeReferralFee);

        (UFixed6 processedOrderReferralFee, UFixed6 processedGuaranteeReferralFee) = chargeFee
            ? _processReferralFee(context, updateContext, orderReferrer, guaranteeReferrer)
            : (UFixed6Lib.ZERO, UFixed6Lib.ZERO);

        // create new order & guarantee
        Order memory newOrder = OrderLib.from(
            context.currentTimestamp,
            updateContext.currentPositionLocal,
            amount,
            processedOrderReferralFee
        );
        Guarantee memory newGuarantee = GuaranteeLib.from(newOrder, price, processedGuaranteeReferralFee, chargeFee);

        // process update
        _update(context, updateContext, newOrder, newGuarantee, orderReferrer, guaranteeReferrer);

        // store updated state
        _storeContext(context);
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
    ) external {
        update(account, newMaker, newLong, newShort, collateral, protect, address(0));
    }

    /// @notice Updates the account's position and collateral
    /// @param account The account to operate on
    /// @param newMaker The new maker position for the account
    /// @param newMaker The new long position for the account
    /// @param newMaker The new short position for the account
    /// @param collateral The collateral amount to add or remove from the account
    /// @param protect Whether to put the account into a protected status for liquidations
    /// @param referrer The referrer of the order
    function update(
        address account,
        UFixed6 newMaker,
        UFixed6 newLong,
        UFixed6 newShort,
        Fixed6 collateral,
        bool protect,
        address referrer
    ) public nonReentrant whenNotPaused {
        // settle market & account
        Context memory context = _loadContext(account);
        SettlementContext memory settlementContext = _sync(context);
        _settle(context, settlementContext);

        // load update context
        UpdateContext memory updateContext = _loadUpdateContext(context, address(0), referrer, UFixed6Lib.ZERO);

        // magic values
        collateral = _processCollateralMagicValue(context, collateral);
        newMaker = _processPositionMagicValue(context, updateContext.currentPositionLocal.maker, newMaker);
        newLong = _processPositionMagicValue(context, updateContext.currentPositionLocal.long, newLong);
        newShort = _processPositionMagicValue(context, updateContext.currentPositionLocal.short, newShort);

        // Compute referral fees
        (UFixed6 processedOrderReferralFee, ) = _processReferralFee(context, updateContext, referrer, address(0));

        // create new order & guarantee
        Order memory newOrder = OrderLib.from(
            context.currentTimestamp,
            updateContext.currentPositionLocal,
            collateral,
            newMaker,
            newLong,
            newShort,
            protect,
            processedOrderReferralFee
        );
        Guarantee memory newGuarantee; // no guarantee is created for a market order

        // process update
        _update(context, updateContext, newOrder, newGuarantee, referrer, address(0));

        // store updated state
        _storeContext(context);
    }

    /// @notice Updates the beneficiary of the market
    /// @param newBeneficiary The new beneficiary address
    function updateBeneficiary(address newBeneficiary) external onlyOwner {
        beneficiary = newBeneficiary;
        emit BeneficiaryUpdated(newBeneficiary);
    }

    /// @notice Updates the coordinator of the market
    /// @param newCoordinator The new coordinator address
    function updateCoordinator(address newCoordinator) external onlyOwner {
        coordinator = newCoordinator;
        emit CoordinatorUpdated(newCoordinator);
    }

    /// @notice Updates the parameter set of the market
    /// @param newParameter The new parameter set
    function updateParameter(MarketParameter memory newParameter) external onlyOwner {
        _parameter.validateAndStore(newParameter, IMarketFactory(address(factory())).parameter());
        emit ParameterUpdated(newParameter);
    }

    /// @notice Updates the risk parameter set of the market
    /// @param newRiskParameter The new risk parameter set
    function updateRiskParameter(RiskParameter memory newRiskParameter) external onlyCoordinator {
        // load latest state
        Global memory newGlobal = _global.read();
        Position memory latestPosition = _position.read();
        RiskParameter memory latestRiskParameter = _riskParameter.read();
        (OracleVersion memory latestOracleVersion, ) = oracle.at(latestPosition.timestamp);

        // update risk parameter (first to capture truncation)
        _riskParameter.validateAndStore(newRiskParameter, IMarketFactory(address(factory())).parameter());
        newRiskParameter = _riskParameter.read();

        // update global exposure
        newGlobal.update(latestRiskParameter, newRiskParameter, latestPosition, latestOracleVersion.price);
        _global.store(newGlobal);

        emit RiskParameterUpdated(newRiskParameter);
    }

    /// @notice Claims any available fee that the sender has accrued
    /// @dev Applicable fees include: protocol, oracle, risk, donation, and claimable
    /// @return feeReceived The amount of the fee claimed
    function claimFee() external returns (UFixed6 feeReceived) {
        Global memory newGlobal = _global.read();
        Local memory newLocal = _locals[msg.sender].read();

        // protocol fee
        if (msg.sender == factory().owner()) {
            feeReceived = feeReceived.add(newGlobal.protocolFee);
            newGlobal.protocolFee = UFixed6Lib.ZERO;
        }

        // oracle fee
        if (msg.sender == address(oracle)) {
            feeReceived = feeReceived.add(newGlobal.oracleFee);
            newGlobal.oracleFee = UFixed6Lib.ZERO;
        }

        // risk fee
        if (msg.sender == coordinator) {
            feeReceived = feeReceived.add(newGlobal.riskFee);
            newGlobal.riskFee = UFixed6Lib.ZERO;
        }

        // claimable
        feeReceived = feeReceived.add(newLocal.claimable);
        newLocal.claimable = UFixed6Lib.ZERO;

        _global.store(newGlobal);
        _locals[msg.sender].store(newLocal);

        if (!feeReceived.isZero()) {
            token.push(msg.sender, UFixed18Lib.from(feeReceived));
            emit FeeClaimed(msg.sender, feeReceived);
        }
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

    /// @notice Returns the global pending guarantee for the given id
    /// @param id The id to query
    function guarantee(uint256 id) external view returns (Guarantee memory) {
        return _guarantee[id].read();
    }

    /// @notice Returns the local pending guarantee for the given account and id
    /// @param account The account to query
    /// @param id The id to query
    function guarantees(address account, uint256 id) external view returns (Guarantee memory) {
        return _guarantees[account][id].read();
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

    /// @notice Loads the transaction context
    /// @param account The account to load for
    /// @return context The transaction context
    function _loadContext(address account) private view returns (Context memory context) {
        // account
        context.account = account;

        // parameters
        context.marketParameter = _parameter.read();
        context.riskParameter = _riskParameter.read();
        context.protocolParameter = IMarketFactory(address(factory())).parameter();

        // oracle
        (context.latestOracleVersion, context.currentTimestamp) = oracle.status();

        // state
        context.global = _global.read();
        context.local = _locals[account].read();

        // latest positions
        context.latestPositionGlobal = _position.read();
        context.latestPositionLocal = _positions[account].read();

        // aggregate pending orders
        context.pendingGlobal = _pending.read();
        context.pendingLocal = _pendings[account].read();
    }

    /// @notice Stores the context for the transaction
    /// @param context The context to store
    function _storeContext(Context memory context) private {
        // state
        _global.store(context.global);
        _locals[context.account].store(context.local);

        // latest positions
        _position.store(context.latestPositionGlobal);
        _positions[context.account].store(context.latestPositionLocal);

        // aggregate pending orders
        _pending.store(context.pendingGlobal);
        _pendings[context.account].store(context.pendingLocal);
    }

    /// @notice Loads the context for the update process
    /// @param context The context to load to
    /// @param signer The signer of the update order, if one exists
    /// @param orderReferrer The order referrer to load for
    /// @param guaranteeReferralFee The guarantee referral fee to load for
    /// @return updateContext The update context
    function _loadUpdateContext(
        Context memory context,
        address signer,
        address orderReferrer,
        UFixed6 guaranteeReferralFee
    ) private view returns (UpdateContext memory updateContext) {
        // load current position
        updateContext.currentPositionGlobal = context.latestPositionGlobal.clone();
        updateContext.currentPositionGlobal.update(context.pendingGlobal);
        updateContext.currentPositionLocal = context.latestPositionLocal.clone();
        updateContext.currentPositionLocal.update(context.pendingLocal);

        // load current order
        updateContext.orderGlobal = _pendingOrder[context.global.currentId].read();
        updateContext.orderLocal = _pendingOrders[context.account][context.local.currentId].read();
        updateContext.guaranteeGlobal = _guarantee[context.global.currentId].read();
        updateContext.guaranteeLocal = _guarantees[context.account][context.local.currentId].read();

        // load order metadata
        updateContext.liquidator = liquidators[context.account][context.local.currentId];
        updateContext.orderReferrer = orderReferrers[context.account][context.local.currentId];
        updateContext.guaranteeReferrer = guaranteeReferrers[context.account][context.local.currentId];

        // load factory metadata
        (updateContext.operator, updateContext.signer, updateContext.orderReferralFee) =
            IMarketFactory(address(factory())).authorization(context.account, msg.sender, signer, orderReferrer);
        updateContext.guaranteeReferralFee = guaranteeReferralFee;
    }

    /// @notice Stores the context for the update process
    /// @param context The transaction context
    /// @param updateContext The update context to store
    function _storeUpdateContext(Context memory context, UpdateContext memory updateContext) private {
        // current orders
        _pendingOrder[context.global.currentId].store(updateContext.orderGlobal);
        _pendingOrders[context.account][context.local.currentId].store(updateContext.orderLocal);
        _guarantee[context.global.currentId].store(updateContext.guaranteeGlobal);
        _guarantees[context.account][context.local.currentId].store(updateContext.guaranteeLocal);

        // external actors
        liquidators[context.account][context.local.currentId] = updateContext.liquidator;
        orderReferrers[context.account][context.local.currentId] = updateContext.orderReferrer;
        guaranteeReferrers[context.account][context.local.currentId] = updateContext.guaranteeReferrer;
    }

    /// @notice Updates the current position with a new order
    /// @param context The context to use
    /// @param updateContext The update context to use
    /// @param newOrder The new order to apply
    /// @param newGuarantee The new guarantee to apply
    /// @param orderReferrer The referrer of the order
    /// @param guaranteeReferrer The referrer of the guarantee
    function _update(
        Context memory context,
        UpdateContext memory updateContext,
        Order memory newOrder,
        Guarantee memory newGuarantee,
        address orderReferrer,
        address guaranteeReferrer
    ) private notSyncOnly(context) {
        // advance to next id if applicable
        if (context.currentTimestamp > updateContext.orderLocal.timestamp) {
            updateContext.orderLocal.next(context.currentTimestamp);
            updateContext.guaranteeLocal.next();
            updateContext.liquidator = address(0);
            updateContext.orderReferrer = address(0);
            updateContext.guaranteeReferrer = address(0);
            context.local.currentId++;
        }
        if (context.currentTimestamp > updateContext.orderGlobal.timestamp) {
            updateContext.orderGlobal.next(context.currentTimestamp);
            updateContext.guaranteeGlobal.next();
            context.global.currentId++;
        }

        // update current position
        updateContext.currentPositionGlobal.update(newOrder);
        updateContext.currentPositionLocal.update(newOrder);

        // apply new order
        updateContext.orderLocal.add(newOrder);
        updateContext.orderGlobal.add(newOrder);
        context.pendingGlobal.add(newOrder);
        context.pendingLocal.add(newOrder);
        updateContext.guaranteeGlobal.add(newGuarantee);
        updateContext.guaranteeLocal.add(newGuarantee);

        // update collateral
        context.local.update(newOrder.collateral);

        // protect account
        if (newOrder.protected()) updateContext.liquidator = msg.sender;

        // apply referrer
        _processReferrer(updateContext, newOrder, newGuarantee, orderReferrer, guaranteeReferrer);

        // request version, only request new price on position change
        oracle.request(IMarket(this), context.account, !newOrder.isEmpty());

        // after
        InvariantLib.validate(context, updateContext, newOrder);

        // store
        _storeUpdateContext(context, updateContext);

        // fund
        if (newOrder.collateral.sign() == 1) token.pull(msg.sender, UFixed18Lib.from(newOrder.collateral.abs()));
        if (newOrder.collateral.sign() == -1) token.push(msg.sender, UFixed18Lib.from(newOrder.collateral.abs()));

        // events
        emit OrderCreated(
            context.account,
            newOrder,
            newGuarantee,
            updateContext.liquidator,
            updateContext.orderReferrer,
            updateContext.guaranteeReferrer
        );
    }

    /// @notice Processes the referral fee for the given order
    /// @param context The context to use
    /// @param updateContext The update context to use
    /// @param orderReferrer The referrer of the order
    /// @param guaranteeReferrer The referrer of the guarantee
    /// @return orderReferralFee The referral fee to apply to the order referrer
    /// @return guaranteeReferralFee The referral fee to apply to the guarantee referrer
    function _processReferralFee(
        Context memory context,
        UpdateContext memory updateContext,
        address orderReferrer,
        address guaranteeReferrer
    ) private pure returns (UFixed6 orderReferralFee, UFixed6 guaranteeReferralFee) {
        if (orderReferrer != address(0))
            orderReferralFee = updateContext.orderReferralFee.isZero()
                ? context.protocolParameter.referralFee
                : updateContext.orderReferralFee;
        if (guaranteeReferrer != address(0)) guaranteeReferralFee = updateContext.guaranteeReferralFee;
    }

    /// @notice Processes the referrer for the given order
    /// @param updateContext The update context to use
    /// @param newOrder The order to process
    /// @param newGuarantee The guarantee to process
    /// @param orderReferrer The referrer of the order
    /// @param guaranteeReferrer The referrer of the guarantee
    function _processReferrer(
        UpdateContext memory updateContext,
        Order memory newOrder,
        Guarantee memory newGuarantee,
        address orderReferrer,
        address guaranteeReferrer
    ) private pure {
        if (!newOrder.makerReferral.isZero() || !newOrder.takerReferral.isZero()) {
            if (updateContext.orderReferrer == address(0)) updateContext.orderReferrer = orderReferrer;
            if (updateContext.orderReferrer != orderReferrer) revert MarketInvalidReferrerError();
        }
        if (!newGuarantee.referral.isZero()) {
            if (updateContext.guaranteeReferrer == address(0)) updateContext.guaranteeReferrer = guaranteeReferrer;
            if (updateContext.guaranteeReferrer != guaranteeReferrer) revert MarketInvalidReferrerError();
        }
    }

    /// @notice Loads the settlement context
    /// @param context The transaction context
    /// @return settlementContext The settlement context
    function _loadSettlementContext(
        Context memory context
    ) private view returns (SettlementContext memory settlementContext) {
        // processing accumulators
        settlementContext.latestVersion = _versions[context.latestPositionGlobal.timestamp].read();
        settlementContext.latestCheckpoint = _checkpoints[context.account][context.latestPositionLocal.timestamp].read();
        (settlementContext.orderOracleVersion, ) = oracle.at(context.latestPositionGlobal.timestamp);
    }

    /// @notice Syncs the account position up to the latest order
    /// @dev - Process orders whose requested prices are now available from oracle
    ///      - All requested prices are guaranteed to be present in the oracle, but could be stale
    /// @param context The context to use
    /// @return settlementContext The settlement context
    function _sync(Context memory context) private returns (SettlementContext memory settlementContext) {
        settlementContext = _loadSettlementContext(context);
        Order memory nextOrder;

        while (
            context.global.currentId != context.global.latestId &&
            (nextOrder = _pendingOrder[context.global.latestId + 1].read()).ready(context.latestOracleVersion)
        ) _processOrderGlobal(context, settlementContext, context.global.latestId + 1, nextOrder.timestamp, nextOrder);

        while (
            context.local.currentId != context.local.latestId &&
            (nextOrder = _pendingOrders[context.account][context.local.latestId + 1].read()).ready(context.latestOracleVersion)
        ) _processOrderLocal(context, settlementContext, context.local.latestId + 1, nextOrder.timestamp, nextOrder);
    }

    /// @notice Settles the account position up to the latest timestamp
    /// @dev - Assumes that _sync has been called prior to this function
    ///      - Advance position timestamps to the latest oracle version
    ///      - Latest versions are guaranteed to have present prices in the oracle, but could be stale
    /// @param context The context to use
    /// @param settlementContext The settlement context to use
    function _settle(Context memory context, SettlementContext memory settlementContext) private notSyncOnly(context) {
        if (context.latestOracleVersion.timestamp > context.latestPositionGlobal.timestamp)
            _processOrderGlobal(
                context,
                settlementContext,
                context.global.latestId,
                context.latestOracleVersion.timestamp,
                _pendingOrder[context.global.latestId].read()
            );
        if (context.latestOracleVersion.timestamp > context.latestPositionLocal.timestamp)
            _processOrderLocal(
                context,
                settlementContext,
                context.local.latestId,
                context.latestOracleVersion.timestamp,
                _pendingOrders[context.account][context.local.latestId].read()
            );
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
            return currentPosition.sub(context.latestPositionLocal.magnitude().sub(context.pendingLocal.neg()));
        }
        return newPosition;
    }

    /// @notice Processes the given global pending position into the latest position
    /// @param context The context to use
    /// @param newOrderId The id of the pending position to process
    /// @param newOrderTimestamp The timestamp of the pending position to process
    /// @param newOrder The pending position to process
    function _processOrderGlobal(
        Context memory context,
        SettlementContext memory settlementContext,
        uint256 newOrderId,
        uint256 newOrderTimestamp,
        Order memory newOrder
    ) private {
        (OracleVersion memory oracleVersion, OracleReceipt memory oracleReceipt) = oracle.at(newOrderTimestamp);
        Guarantee memory newGuarantee = _guarantee[newOrderId].read();

        // if latest timestamp is more recent than order timestamp, sync the order data
        if (newOrderTimestamp > newOrder.timestamp) {
            newOrder.next(newOrderTimestamp);
            newGuarantee.next();
        }

        context.pendingGlobal.sub(newOrder);

        // if version is not valid, invalidate order data
        if (!oracleVersion.valid) {
            newOrder.invalidate();
            newGuarantee.invalidate();
        }

        VersionAccumulationContext memory accumulationContext = VersionAccumulationContext(
            context.global,
            context.latestPositionGlobal,
            newOrder,
            newGuarantee,
            settlementContext.orderOracleVersion,
            oracleVersion,
            oracleReceipt,
            context.marketParameter,
            context.riskParameter
        );
        VersionAccumulationResult memory accumulationResult;
        (settlementContext.latestVersion, context.global, accumulationResult) =
            VersionLib.accumulate(settlementContext.latestVersion, accumulationContext);

        context.global.update(newOrderId, accumulationResult, context.marketParameter, oracleReceipt);
        context.latestPositionGlobal.update(newOrder);

        settlementContext.orderOracleVersion = oracleVersion;
        _versions[newOrder.timestamp].store(settlementContext.latestVersion);

        emit PositionProcessed(newOrderId, newOrder, accumulationResult);
    }

    /// @notice Processes the given local pending position into the latest position
    /// @param context The context to use
    /// @param newOrderId The id of the pending position to process
    /// @param newOrderTimestamp The timestamp of the pending position to process
    /// @param newOrder The pending order to process
    function _processOrderLocal(
        Context memory context,
        SettlementContext memory settlementContext,
        uint256 newOrderId,
        uint256 newOrderTimestamp,
        Order memory newOrder
    ) private {
        Version memory versionFrom = _versions[context.latestPositionLocal.timestamp].read();
        Version memory versionTo = _versions[newOrderTimestamp].read();
        Guarantee memory newGuarantee = _guarantees[context.account][newOrderId].read();

        // if latest timestamp is more recent than order timestamp, sync the order data
        if (newOrderTimestamp > newOrder.timestamp) {
            newOrder.next(newOrderTimestamp);
            newGuarantee.next();
        }

        context.pendingLocal.sub(newOrder);

        // if version is not valid, invalidate order data
        if (!versionTo.valid) {
            newOrder.invalidate();
            newGuarantee.invalidate();
        }

        CheckpointAccumulationResult memory accumulationResult;
        (settlementContext.latestCheckpoint, accumulationResult) = CheckpointLib.accumulate(
            settlementContext.latestCheckpoint,
            newOrder,
            newGuarantee,
            context.latestPositionLocal,
            versionFrom,
            versionTo
        );

        context.local.update(newOrderId, accumulationResult);
        context.latestPositionLocal.update(newOrder);

        _checkpoints[context.account][newOrder.timestamp].store(settlementContext.latestCheckpoint);

        _credit(context, liquidators[context.account][newOrderId], accumulationResult.liquidationFee);
        _credit(context, orderReferrers[context.account][newOrderId], accumulationResult.subtractiveFee);
        _credit(context, guaranteeReferrers[context.account][newOrderId], accumulationResult.solverFee);

        emit AccountPositionProcessed(context.account, newOrderId, newOrder, accumulationResult);
    }

    /// @notice Credits an account's claimable
    /// @dev The amount must have already come from a corresponding debit in the settlement flow.
    ///      If the receiver is the context's account, the amount is instead credited in-memory.
    /// @param context The context to use
    /// @param receiver The account to credit
    /// @param amount The amount to credit
    function _credit(Context memory context, address receiver, UFixed6 amount) private {
        if (amount.isZero()) return;

        if (receiver == context.account) context.local.credit(amount);
        else {
            Local memory receiverLocal = _locals[receiver].read();
            receiverLocal.credit(amount);
            _locals[receiver].store(receiverLocal);
        }
    }

    /// @notice Only the coordinator or the owner can call
    modifier onlyCoordinator {
        if (msg.sender != coordinator && msg.sender != factory().owner()) revert MarketNotCoordinatorError();
        _;
    }

    /// @notice Only when the market is not in sync-only mode
    modifier notSyncOnly(Context memory context) {
        if (context.marketParameter.syncOnly) revert MarketSettleOnlyError();
        _;
    }
}
