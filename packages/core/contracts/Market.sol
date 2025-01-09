// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { UFixed18, UFixed18Lib } from "@equilibria/root/number/types/UFixed18.sol";
import { Fixed6, Fixed6Lib } from "@equilibria/root/number/types/Fixed6.sol";
import { Token18 } from "@equilibria/root/token/types/Token18.sol";
import { Instance } from "@equilibria/root/attribute/Instance.sol";
import { ReentrancyGuard } from "@equilibria/root/attribute/ReentrancyGuard.sol";
import { IMarket } from "./interfaces/IMarket.sol";
import { IMarketFactory } from "./interfaces/IMarketFactory.sol";
import { IOracleProvider } from "./interfaces/IOracleProvider.sol";
import { IVerifier } from "./interfaces/IVerifier.sol";
import { MarketParameter, MarketParameterStorage } from "./types/MarketParameter.sol";
import { RiskParameter, RiskParameterStorage } from "./types/RiskParameter.sol";
import { Global, GlobalStorage } from "./types/Global.sol";
import { Position, PositionStorageGlobal, PositionStorageLocal } from "./types/Position.sol";
import { Local, LocalStorage } from "./types/Local.sol";
import { Version, VersionStorage } from "./types/Version.sol";
import { Order, OrderLib, OrderStorageGlobal, OrderStorageLocal } from "./types/Order.sol";
import { Guarantee, GuaranteeLib, GuaranteeStorageGlobal, GuaranteeStorageLocal } from "./types/Guarantee.sol";
import { Checkpoint, CheckpointStorage } from "./types/Checkpoint.sol";
import { Intent } from "./types/Intent.sol";
import { OracleVersion } from "./types/OracleVersion.sol";
import { OracleReceipt } from "./types/OracleReceipt.sol";
import { InvariantLib } from "./libs/InvariantLib.sol";
import { VersionAccumulationResponse, VersionLib } from "./libs/VersionLib.sol";
import { CheckpointAccumulationResponse, CheckpointLib } from "./libs/CheckpointLib.sol";

/// @title Market
/// @notice Manages logic and state for a single market.
/// @dev Cloned by the Factory contract to launch new markets.
contract Market is IMarket, Instance, ReentrancyGuard {
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

    /// @notice Settles the account's position and collateral
    /// @param account The account to operate on
    function settle(address account) external nonReentrant whenNotPaused {
        Context memory context = _loadContext(account);

        _settle(context);

        _storeContext(context);
    }

    /// @notice Updates both the long and short positions of an intent order
    /// @dev - One side is specified in the signed intent, while the sender is assumed to be the counterparty
    ///      - The sender is charged the settlement fee
    /// @param account The account that is filling this intent (maker)
    /// @param intent The intent that is being filled
    /// @param signature The signature of the intent that is being filled
    function update(address account, Intent calldata intent, bytes memory signature) external nonReentrant whenNotPaused {
        if (intent.fee.gt(UFixed6Lib.ONE)) revert MarketInvalidIntentFeeError();

        verifier.verifyIntent(intent, signature);

        _updateIntent(
            account,
            address(0),
            intent.amount.mul(Fixed6Lib.NEG_ONE),
            intent.price,
            address(0),
            address(0),
            UFixed6Lib.ZERO,
            UFixed6Lib.ZERO,
            true,
            false
        ); // account
        _updateIntent(
            intent.common.account,
            intent.common.signer,
            intent.amount,
            intent.price,
            intent.originator,
            intent.solver,
            intent.fee,
            intent.collateralization,
            false,
            true
        ); // signer
    }

    /// @notice Updates the account's position and collateral
    /// @param account The account to operate on
    /// @param takerAmount The position delta of the order (positive for long, negative for short)
    /// @param collateral The collateral delta of the order (positive for deposit, negative for withdrawal)
    /// @param referrer The referrer of the order
    function update(
        address account,
        Fixed6 takerAmount,
        Fixed6 collateral,
        address referrer
    ) external {
        update(account, Fixed6Lib.ZERO, takerAmount, collateral, referrer);
    }

    /// @notice Updates the account's position and collateral
    /// @param account The account to operate on
    /// @param makerAmount The maker of the order
    /// @param takerAmount The taker of the order (positive for long, negative for short)
    /// @param collateral The collateral delta of the order (positive for deposit, negative for withdrawal)
    /// @param referrer The referrer of the order
    function update(
        address account,
        Fixed6 makerAmount,
        Fixed6 takerAmount,
        Fixed6 collateral,
        address referrer
    ) public nonReentrant whenNotPaused {
        (Context memory context, UpdateContext memory updateContext) =
            _loadForUpdate(account, address(0), referrer, address(0), UFixed6Lib.ZERO, UFixed6Lib.ZERO);

        // create new order & guarantee
        Order memory newOrder = OrderLib.from(
            context.currentTimestamp,
            updateContext.currentPositionLocal,
            makerAmount,
            takerAmount,
            collateral,
            false,
            updateContext.orderReferralFee
        );
        Guarantee memory newGuarantee; // no guarantee is created for a market order

        // process update
        _updateAndStore(context, updateContext, newOrder, newGuarantee, referrer, address(0));
    }

    /// @notice Closes the account's position
    /// @param account The account to operate on
    /// @param protect Whether to put the account into a protected status for liquidations
    /// @param referrer The referrer of the order
    function close(address account, bool protect, address referrer) external {
        (Context memory context, UpdateContext memory updateContext) =
            _loadForUpdate(account, address(0), referrer, address(0), UFixed6Lib.ZERO, UFixed6Lib.ZERO);

        Fixed6 makerAmount;
        Fixed6 takerAmount;

        UFixed6 closable = context.latestPositionLocal.magnitude().sub(context.pendingLocal.neg());

        if (updateContext.currentPositionLocal.maker.gt(UFixed6Lib.ZERO)) {
            makerAmount = Fixed6Lib.from(-1, closable);
        } else if (updateContext.currentPositionLocal.long.gt(UFixed6Lib.ZERO)) {
            takerAmount = Fixed6Lib.from(-1, closable);
        } else {
            takerAmount = Fixed6Lib.from(1, closable);
        }

        // create new order & guarantee
        Order memory newOrder = OrderLib.from(
            context.currentTimestamp,
            updateContext.currentPositionLocal,
            makerAmount,
            takerAmount,
            Fixed6Lib.ZERO,
            protect,
            updateContext.orderReferralFee
        );

        Guarantee memory newGuarantee; // no guarantee is created for a market order

        // process update
        _updateAndStore(context, updateContext, newOrder, newGuarantee, referrer, address(0));
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

        // update risk parameter (first to capture truncation)
        _riskParameter.validateAndStore(newRiskParameter, IMarketFactory(address(factory())).parameter());
        newRiskParameter = _riskParameter.read();

        // update global exposure
        newGlobal.update(latestRiskParameter, newRiskParameter, latestPosition);
        _global.store(newGlobal);

        emit RiskParameterUpdated(newRiskParameter);
    }

    /// @notice Claims any available fee that the sender has accrued
    /// @dev Applicable fees include: protocol, oracle, risk, donation, and claimable
    /// @return feeReceived The amount of the fee claimed
    function claimFee(address account) external onlyOperator(account) returns (UFixed6 feeReceived) {
        Global memory newGlobal = _global.read();
        Local memory newLocal = _locals[account].read();

        // protocol fee
        if (account == factory().owner()) {
            feeReceived = feeReceived.add(newGlobal.protocolFee);
            newGlobal.protocolFee = UFixed6Lib.ZERO;
        }

        // oracle fee
        if (account == address(oracle)) {
            feeReceived = feeReceived.add(newGlobal.oracleFee);
            newGlobal.oracleFee = UFixed6Lib.ZERO;
        }

        // risk fee
        if (account == coordinator) {
            feeReceived = feeReceived.add(newGlobal.riskFee);
            newGlobal.riskFee = UFixed6Lib.ZERO;
        }

        // claimable
        feeReceived = feeReceived.add(newLocal.claimable);
        newLocal.claimable = UFixed6Lib.ZERO;

        _global.store(newGlobal);
        _locals[account].store(newLocal);

        if (!feeReceived.isZero()) {
            token.push(msg.sender, UFixed18Lib.from(feeReceived));
            emit FeeClaimed(account, msg.sender, feeReceived);
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
    /// @param guaranteeReferrer The guarantee referrer to load for
    /// @param guaranteeReferralFee The guarantee referral fee to load for
    /// @param collateralization The collateralization to load for
    /// @return updateContext The update context
    function _loadUpdateContext(
        Context memory context,
        address signer,
        address orderReferrer,
        address guaranteeReferrer,
        UFixed6 guaranteeReferralFee,
        UFixed6 collateralization
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
        updateContext.collateralization = collateralization;

        // load factory metadata
        (updateContext.operator, updateContext.signer, updateContext.orderReferralFee) =
            IMarketFactory(address(factory())).authorization(context.account, msg.sender, signer, orderReferrer);
        if (guaranteeReferrer != address(0)) updateContext.guaranteeReferralFee = guaranteeReferralFee;
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

    /// @notice Loads the both context and update context, and settles the account
    /// @param account The account to load the context for
    /// @param signer The signer of the update order, if one exists
    /// @param orderReferrer The order referrer, if one exists
    /// @param guaranteeReferrer The guarantee referrer, if one exists
    /// @param guaranteeReferralFee The guarantee referral fee, if one exists
    /// @param collateralization The collateralization override for the order, if one exists
    function _loadForUpdate(
        address account,
        address signer,
        address orderReferrer,
        address guaranteeReferrer,
        UFixed6 guaranteeReferralFee,
        UFixed6 collateralization
    ) private returns (Context memory context, UpdateContext memory updateContext) {
        // settle market & account
        context = _loadContext(account);
        _settle(context);

        // load update context
        updateContext =
            _loadUpdateContext(context, signer, orderReferrer, guaranteeReferrer, guaranteeReferralFee, collateralization);
    }

    /// @notice Updates the account's position and collateral, and stores the resulting context in state
    /// @param context The context to use
    /// @param updateContext The update context to use
    /// @param newOrder The new order to apply
    /// @param newGuarantee The new guarantee to apply
    /// @param orderReferrer The referrer of the order
    /// @param guaranteeReferrer The referrer of the guarantee
    function _updateAndStore(
        Context memory context,
        UpdateContext memory updateContext,
        Order memory newOrder,
        Guarantee memory newGuarantee,
        address orderReferrer,
        address guaranteeReferrer
    ) private {
        // process update
        _update(context, updateContext, newOrder, newGuarantee, orderReferrer, guaranteeReferrer);

        // store updated state
        _storeContext(context);
    }

    /// @notice Updates the account's position for an intent order
    /// @param account The account to operate on
    /// @param signer The signer of the order
    /// @param amount The size and direction of the order being opened
    /// @param price The price to execute the order at
    /// @param orderReferrer The referrer of the order
    /// @param guaranteeReferrer The referrer of the guarantee
    /// @param guaranteeReferralFee The referral fee for the guarantee
    /// @param collateralization The minimum collateralization ratio that must be maintained after the order is executed
    /// @param chargeSettlementFee Whether to charge the settlement fee
    /// @param chargeTradeFee Whether to charge the trade fee
    function _updateIntent(
        address account,
        address signer,
        Fixed6 amount,
        Fixed6 price,
        address orderReferrer,
        address guaranteeReferrer,
        UFixed6 guaranteeReferralFee,
        UFixed6 collateralization,
        bool chargeSettlementFee,
        bool chargeTradeFee
    ) private {
        (Context memory context, UpdateContext memory updateContext) =
            _loadForUpdate(account, signer, orderReferrer, guaranteeReferrer, guaranteeReferralFee, collateralization);

        // create new order & guarantee
        Order memory newOrder = OrderLib.from(
            context.currentTimestamp,
            updateContext.currentPositionLocal,
            Fixed6Lib.ZERO,
            amount,
            Fixed6Lib.ZERO,
            false,
            updateContext.orderReferralFee
        );
        Guarantee memory newGuarantee = GuaranteeLib.from(
            newOrder,
            price,
            updateContext.guaranteeReferralFee,
            chargeSettlementFee,
            chargeTradeFee
        );

        _updateAndStore(context, updateContext, newOrder, newGuarantee, orderReferrer, guaranteeReferrer);
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
    ) private notSettleOnly(context) {
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
        if (!newOrder.isEmpty()) oracle.request(IMarket(this), context.account);

        // after
        InvariantLib.validate(context, updateContext, newOrder, newGuarantee);

        // store
        _storeUpdateContext(context, updateContext);

        // fund
        if (newOrder.collateral.sign() == 1) token.pull(msg.sender, UFixed18Lib.from(newOrder.collateral.abs()));
        if (newOrder.collateral.sign() == -1) token.push(msg.sender, UFixed18Lib.from(newOrder.collateral.abs()));
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
        settlementContext.latestVersion = _versions[context.latestPositionGlobal.timestamp].read();
        settlementContext.latestCheckpoint = _checkpoints[context.account][context.latestPositionLocal.timestamp].read();

        (settlementContext.orderOracleVersion, ) = oracle.at(context.latestPositionGlobal.timestamp);
        context.global.overrideIfZero(settlementContext.orderOracleVersion);
    }

    /// @notice Settles the account position up to the latest version
    /// @param context The context to use
    function _settle(Context memory context) private {
        SettlementContext memory settlementContext = _loadSettlementContext(context);

        Order memory nextOrder;

        // settle - process orders whose requested prices are now available from oracle
        //        - all requested prices are guaranteed to be present in the oracle, but could be stale
        while (
            context.global.currentId != context.global.latestId &&
            (nextOrder = _pendingOrder[context.global.latestId + 1].read()).ready(context.latestOracleVersion)
        ) _processOrderGlobal(context, settlementContext, context.global.latestId + 1, nextOrder.timestamp, nextOrder);

        while (
            context.local.currentId != context.local.latestId &&
            (nextOrder = _pendingOrders[context.account][context.local.latestId + 1].read()).ready(context.latestOracleVersion)
        ) _processOrderLocal(context, settlementContext, context.local.latestId + 1, nextOrder.timestamp, nextOrder);

        // don't sync in settle-only mode
        if (context.marketParameter.settle) return;

        // sync - advance position timestamps to the latest oracle version
        //      - latest versions are guaranteed to have present prices in the oracle, but could be stale
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
        context.global.overrideIfZero(oracleVersion);
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

        VersionAccumulationResponse memory accumulationResponse;
        (settlementContext.latestVersion, context.global, accumulationResponse) = VersionLib.accumulate(
            context,
            settlementContext,
            newOrderId,
            newOrder,
            newGuarantee,
            oracleVersion,
            oracleReceipt
        );

        context.global.update(newOrderId, accumulationResponse, context.marketParameter, oracleReceipt);
        context.latestPositionGlobal.update(newOrder);

        settlementContext.orderOracleVersion = oracleVersion;
        _versions[newOrder.timestamp].store(settlementContext.latestVersion);
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

        CheckpointAccumulationResponse memory accumulationResponse;
        (settlementContext.latestCheckpoint, accumulationResponse) = CheckpointLib.accumulate(
            context,
            settlementContext,
            newOrderId,
            newOrder,
            newGuarantee,
            versionFrom,
            versionTo
        );

        context.local.update(newOrderId, accumulationResponse);
        context.latestPositionLocal.update(newOrder);

        _checkpoints[context.account][newOrder.timestamp].store(settlementContext.latestCheckpoint);

        _credit(context, liquidators[context.account][newOrderId], accumulationResponse.liquidationFee);
        _credit(context, orderReferrers[context.account][newOrderId], accumulationResponse.subtractiveFee);
        _credit(context, guaranteeReferrers[context.account][newOrderId], accumulationResponse.solverFee);
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

    /// @notice Only the account or an operator can call
    modifier onlyOperator(address account) {
        if (msg.sender != account && !IMarketFactory(address(factory())).operators(account, msg.sender))
            revert MarketNotOperatorError();
        _;
    }

    /// @notice Only when the market is not in settle-only mode
    modifier notSettleOnly(Context memory context) {
        if (context.marketParameter.settle) revert MarketSettleOnlyError();
        _;
    }
}
