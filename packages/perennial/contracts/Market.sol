// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "@equilibria/root-v2/contracts/Instance.sol";
import "./interfaces/IMarket.sol";
import "./interfaces/IMarketFactory.sol";
import "hardhat/console.sol";

/**
 * @title Market
 * @notice Manages logic and state for a single market market.
 * @dev Cloned by the Factory contract to launch new market markets.
 */
contract Market is IMarket, Instance {
    bool private constant GAS_PROFILE = false;
    bool private constant LOG_REVERTS = false;

    /// @dev The name of the market
    string public name;

    /// @dev The symbol of the market
    string public symbol;

    /// @dev ERC20 stablecoin for collateral
    Token18 public token;

    /// @dev ERC20 token for reward
    Token18 public reward;

    IOracleProvider public oracle;

    IPayoffProvider public payoff;

    /// @dev Beneficiary of the market, receives donations
    address public beneficiary;

    /// @dev Risk coordinator of the market
    address public coordinator;

    RiskParameterStorage private _riskParameter;

    MarketParameterStorage private _parameter;

    /// @dev Protocol and market fees collected, but not yet claimed
    GlobalStorage private _global;

    PositionStorageGlobal private _position;

    mapping(uint256 => PositionStorageGlobal) private _pendingPosition;

    /// @dev The individual state for each account
    mapping(address => LocalStorage) private _locals;

    mapping(address => PositionStorageLocal) private _positions;

    mapping(address => mapping(uint256 => PositionStorageLocal)) private _pendingPositions;

    /// @dev Mapping of the historical version data
    mapping(uint256 => VersionStorage) private _versions;

    /**
     * @notice Initializes the contract state
     */
    function initialize(
        IMarket.MarketDefinition calldata definition_,
        RiskParameter calldata riskParameter_
    ) external initializer(1) {
        __Instance__initialize();

        name = definition_.name;
        symbol = definition_.symbol;
        token = definition_.token;
        oracle = definition_.oracle;
        payoff = definition_.payoff;
        _updateRiskParameter(riskParameter_); // TODO: don't set or use version with invariant
    }

    function update(
        address account,
        UFixed6 newMaker,
        UFixed6 newLong,
        UFixed6 newShort,
        Fixed6 collateral,
        bool protect
    ) external whenNotPaused {
        Context memory context = _loadContext(account);
        _settle(context, account);
        _update(context, account, newMaker, newLong, newShort, collateral, protect);
        _saveContext(context, account);
    }

    function updateBeneficiary(address newBeneficiary) external onlyOwner {
        beneficiary = newBeneficiary;
        emit BeneficiaryUpdated(newBeneficiary);
    }

    function updateCoordinator(address newCoordinator) external onlyOwner {
        coordinator = newCoordinator;
        emit CoordinatorUpdated(newCoordinator);
    }

    function updateParameter(MarketParameter memory newParameter) external onlyOwner {
        ProtocolParameter memory protocolParameter = IMarketFactory(address(factory())).parameter();

        if (newParameter.fundingFee.gt(protocolParameter.maxCut)) revert MarketInvalidMarketParameterError(1);
        if (newParameter.interestFee.gt(protocolParameter.maxCut)) revert MarketInvalidMarketParameterError(2);
        if (newParameter.positionFee.gt(protocolParameter.maxCut)) revert MarketInvalidMarketParameterError(3);
        if (newParameter.settlementFee.gt(protocolParameter.maxFeeAbsolute))
            revert MarketInvalidMarketParameterError(4);
        if (newParameter.oracleFee.add(newParameter.riskFee).gt(UFixed6Lib.ONE))
            revert MarketInvalidMarketParameterError(5);
        if (reward.isZero() && (
                !newParameter.makerRewardRate.isZero() ||
                !newParameter.longRewardRate.isZero() ||
                !newParameter.shortRewardRate.isZero()
        )) revert MarketInvalidMarketParameterError(6);

        _parameter.store(newParameter);
        emit ParameterUpdated(newParameter);
    }

    function updateRiskParameter(RiskParameter memory newRiskParameter) external onlyCoordinator {
        ProtocolParameter memory protocolParameter = IMarketFactory(address(factory())).parameter();

        if (newRiskParameter.maintenance.lt(protocolParameter.minMaintenance))
            revert MarketInvalidRiskParameterError(1);
        if (newRiskParameter.takerFee.gt(protocolParameter.maxFee)) revert MarketInvalidRiskParameterError(2);
        if (newRiskParameter.takerSkewFee.gt(protocolParameter.maxFee)) revert MarketInvalidRiskParameterError(3);
        if (newRiskParameter.takerImpactFee.gt(protocolParameter.maxFee)) revert MarketInvalidRiskParameterError(4);
        if (newRiskParameter.makerFee.gt(protocolParameter.maxFee)) revert MarketInvalidRiskParameterError(5);
        if (newRiskParameter.makerImpactFee.gt(protocolParameter.maxFee)) revert MarketInvalidRiskParameterError(6);
        if (newRiskParameter.efficiencyLimit.lt(protocolParameter.minEfficiency))
            revert MarketInvalidRiskParameterError(7);
        if (newRiskParameter.liquidationFee.gt(protocolParameter.maxCut)) revert MarketInvalidRiskParameterError(8);
        if (newRiskParameter.minLiquidationFee.gt(protocolParameter.maxFeeAbsolute))
            revert MarketInvalidRiskParameterError(9);
        if (newRiskParameter.maxLiquidationFee.gt(protocolParameter.maxFeeAbsolute))
            revert MarketInvalidRiskParameterError(10);
        if (newRiskParameter.utilizationCurve.minRate.gt(protocolParameter.maxRate))
            revert MarketInvalidRiskParameterError(11);
        if (newRiskParameter.utilizationCurve.maxRate.gt(protocolParameter.maxRate))
            revert MarketInvalidRiskParameterError(12);
        if (newRiskParameter.utilizationCurve.targetRate.gt(protocolParameter.maxRate))
            revert MarketInvalidRiskParameterError(13);
        if (newRiskParameter.utilizationCurve.targetUtilization.gt(UFixed6Lib.ONE))
            revert MarketInvalidRiskParameterError(14);
        if (newRiskParameter.pController.max.gt(protocolParameter.maxRate))
            revert MarketInvalidRiskParameterError(15);
        if (
            newRiskParameter.minMaintenance.gt(protocolParameter.maxFeeAbsolute) ||
            newRiskParameter.minMaintenance.lt(newRiskParameter.minLiquidationFee)
        ) revert MarketInvalidRiskParameterError(16);

        _updateRiskParameter(newRiskParameter);
    }

    function updateReward(Token18 newReward) public onlyOwner {
        if (!reward.eq(Token18Lib.ZERO)) revert MarketRewardAlreadySetError();
        if (newReward.eq(token)) revert MarketInvalidRewardError();

        reward = newReward;
        emit RewardUpdated(newReward);
    }

    function claimFee() external {
        Global memory newGlobal = _global.read();

        if (_claimFee(address(factory()), newGlobal.protocolFee)) newGlobal.protocolFee = UFixed6Lib.ZERO;
        if (_claimFee(address(IMarketFactory(address(factory())).oracleFactory()), newGlobal.oracleFee))
            newGlobal.oracleFee = UFixed6Lib.ZERO;
        if (_claimFee(coordinator, newGlobal.riskFee)) newGlobal.riskFee = UFixed6Lib.ZERO;
        if (_claimFee(beneficiary, newGlobal.donation)) newGlobal.donation = UFixed6Lib.ZERO;

        _global.store(newGlobal);
    }

    function _claimFee(address receiver, UFixed6 fee) private returns (bool) {
        if (msg.sender != receiver) return false;

        token.push(receiver, UFixed18Lib.from(fee));
        emit FeeClaimed(receiver, fee);
        return true;
    }

    function claimReward() external {
        Local memory newLocal = _locals[msg.sender].read();

        reward.push(msg.sender, UFixed18Lib.from(newLocal.reward));
        emit RewardClaimed(msg.sender, newLocal.reward);

        newLocal.clearReward();
        _locals[msg.sender].store(newLocal);
    }

    function parameter() external view returns (MarketParameter memory) {
        return _parameter.read();
    }

    function riskParameter() external view returns (RiskParameter memory) {
        return _riskParameter.read();
    }

    function position() external view returns (Position memory) {
        return _position.read();
    }

    function positions(address account) external view returns (Position memory) {
        return _positions[account].read();
    }

    function global() external view returns (Global memory) {
        return _global.read();
    }

    function versions(uint256 oracleVersion) external view returns (Version memory) {
        return _versions[oracleVersion].read();
    }

    function locals(address account) external view returns (Local memory) {
        return _locals[account].read();
    }

    function pendingPosition(uint256 id) external view returns (Position memory) {
        return _pendingPosition[id].read();
    }

    function pendingPositions(address account, uint256 id) external view returns (Position memory) {
        return _pendingPositions[account][id].read();
    }

    function at(uint256 timestamp) public view returns (OracleVersion memory) {
        return _oracleVersionAt(timestamp);
    }

    function _update(
        Context memory context,
        address account,
        UFixed6 newMaker,
        UFixed6 newLong,
        UFixed6 newShort,
        Fixed6 collateral,
        bool protect
    ) private {
        _startGas(context, "_update before-update-after: %s");

        // read
        context.currentPosition.global = context.global.currentId == context.latestPosition.global.id ?
            _position.read() :
            _pendingPosition[context.global.currentId].read();
        context.currentPosition.local = context.local.currentId == context.latestPosition.local.id ?
            _positions[account].read() :
            _pendingPositions[account][context.local.currentId].read();

        // magic values
        if (collateral.eq(Fixed6Lib.MIN)) collateral = context.local.collateral.mul(Fixed6Lib.NEG_ONE);
        if (newMaker.eq(UFixed6Lib.MAX)) newMaker = context.currentPosition.local.maker;
        if (newLong.eq(UFixed6Lib.MAX)) newLong = context.currentPosition.local.long;
        if (newShort.eq(UFixed6Lib.MAX)) newShort = context.currentPosition.local.short;

        // update position
        if (context.currentTimestamp > context.currentPosition.local.timestamp) context.local.currentId++;
        Order memory newOrder = context.currentPosition.local
            .update(context.local.currentId, context.currentTimestamp, newMaker, newLong, newShort);
        if (context.currentTimestamp > context.currentPosition.global.timestamp) context.global.currentId++;
        context.currentPosition.global.update(context.global.currentId, context.currentTimestamp, newOrder);

        // update fee
        newOrder.registerFee(context.latestVersion, context.marketParameter, context.riskParameter);
        context.currentPosition.local.registerFee(newOrder);
        context.currentPosition.global.registerFee(newOrder);

        // update collateral
        context.local.update(collateral);
        context.currentPosition.local.update(collateral);

        // protect account
        bool protected = context.local.protect(context.latestPosition.local, context.currentTimestamp, protect);

        // request version
        if (!newOrder.isEmpty()) oracle.request();

        // after
        _invariant(context, account, newOrder, collateral, protected);

        // store
        if (context.global.currentId > context.latestPosition.global.id) // don't re-store if already settled
            _pendingPosition[context.global.currentId].store(context.currentPosition.global);
        if (context.local.currentId > context.latestPosition.local.id) // don't re-store if already settled
            _pendingPositions[account][context.local.currentId].store(context.currentPosition.local);

        _endGas(context);

        _startGas(context, "_update fund-events: %s");

        // fund
        if (collateral.sign() == 1) token.pull(msg.sender, UFixed18Lib.from(collateral.abs()));
        if (collateral.sign() == -1) token.push(msg.sender, UFixed18Lib.from(collateral.abs()));

        // events
        emit Updated(account, context.currentTimestamp, newMaker, newLong, newShort, collateral, protect);

        _endGas(context);
    }

    function _loadContext(address account) private view returns (Context memory context) {
        _startGas(context, "_loadContext: %s");

        // parameters
        context.protocolParameter = IMarketFactory(address(factory())).parameter();
        context.marketParameter = _parameter.read();
        context.riskParameter = _riskParameter.read();

        // state
        context.global = _global.read();
        context.local = _locals[account].read();

        // oracle
        (context.latestVersion, context.currentTimestamp) = _oracleVersion();
        context.positionVersion = _oracleVersionAtPosition(context, _position.read()); // TODO: remove this

        // after
        _endGas(context);
    }

    function _saveContext(Context memory context, address account) private {
        _startGas(context, "_saveContext: %s");

        _global.store(context.global);
        _locals[account].store(context.local);

        _endGas(context);
    }

    function _settle(Context memory context, address account) private {
        _startGas(context, "_settle: %s");

        context.latestPosition.global = _position.read();
        context.latestPosition.local = _positions[account].read();

        Position memory nextPosition;

        // settle
        while (
            context.global.currentId != context.latestPosition.global.id &&
            (nextPosition = _pendingPosition[context.latestPosition.global.id + 1].read()).ready(context.latestVersion)
        ) _processPosition(context, nextPosition);

        while (
            context.local.currentId != context.latestPosition.local.id &&
            (nextPosition = _pendingPositions[account][context.latestPosition.local.id + 1].read())
                .ready(context.latestVersion)
        ) {
            Fixed6 previousDelta = _pendingPositions[account][context.latestPosition.local.id].read().delta; // TODO: cleanup

            _processPositionAccount(context, account, nextPosition);

            Position memory latestAccountPosition = _pendingPositions[account][context.latestPosition.local.id].read(); // TODO: cleanup
            latestAccountPosition.collateral = context.local.collateral
                .sub(context.currentPosition.local.delta.sub(previousDelta))  // deposits happen after snapshot point
                .add(Fixed6Lib.from(nextPosition.fee));                       // position fee happens after snapshot point
            _pendingPositions[account][latestAccountPosition.id].store(latestAccountPosition);
        }

        _endGas(context);

        _startGas(context, "_sync: %s");

        // sync
        if (context.latestVersion.timestamp > context.latestPosition.global.timestamp) {
            nextPosition = _pendingPosition[context.latestPosition.global.id].read();
            nextPosition.timestamp = context.latestVersion.timestamp;
            nextPosition.fee = UFixed6Lib.ZERO;
            nextPosition.keeper = UFixed6Lib.ZERO;
            _processPosition(context, nextPosition);
        }

        if (context.latestVersion.timestamp > context.latestPosition.local.timestamp) {
            nextPosition = _pendingPositions[account][context.latestPosition.local.id].read();
            nextPosition.timestamp = context.latestVersion.timestamp;
            nextPosition.fee = UFixed6Lib.ZERO;
            nextPosition.keeper = UFixed6Lib.ZERO;
            _processPositionAccount(context, account, nextPosition);
        }

        _position.store(context.latestPosition.global);
        _positions[account].store(context.latestPosition.local);

        _endGas(context);
    }

    function _processPosition(
        Context memory context,
        Position memory newPosition
    ) private {
        Version memory version = _versions[context.latestPosition.global.timestamp].read();
        OracleVersion memory oracleVersion = _oracleVersionAtPosition(context, newPosition); // TODO: seems weird some logic is in here
        if (!oracleVersion.valid) newPosition.invalidate(context.latestPosition.global); // TODO: combine this with sync logic?

        (uint256 fromTimestamp, uint256 fromId) = (context.latestPosition.global.timestamp, context.latestPosition.global.id);
        (VersionAccumulationResult memory accumulationResult, UFixed6 accumulatedFee) = version.accumulate(
            context.global,
            context.latestPosition.global,
            newPosition,
            context.positionVersion, // TODO: ??
            oracleVersion,
            context.marketParameter,
            context.riskParameter
        );
        context.latestPosition.global.update(newPosition);
        context.global.update(oracleVersion.price);
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
            accumulationResult
        );
    }

    function _processPositionAccount(Context memory context, address account, Position memory newPosition) private {
        Version memory version = _versions[newPosition.timestamp].read();
        if (!version.valid) newPosition.invalidate(context.latestPosition.local);

        (uint256 fromTimestamp, uint256 fromId) = (context.latestPosition.local.timestamp, context.latestPosition.local.id);
        LocalAccumulationResult memory accumulationResult = context.local.accumulate(
            context.latestPosition.local,
            newPosition,
            _versions[context.latestPosition.local.timestamp].read(),
            version
        );
        context.latestPosition.local.update(newPosition);

        // events
        emit AccountPositionProcessed(
            account,
            fromTimestamp,
            newPosition.timestamp,
            fromId,
            accumulationResult
        );
    }

    function _invariant(
        Context memory context,
        address account,
        Order memory newOrder,
        Fixed6 collateral,
        bool protected
    ) private view {
        if (protected && (
            !context.currentPosition.local.magnitude().isZero() ||
            context.latestPosition.local.collateralized(
                context.latestVersion,
                context.riskParameter,
                context.local.collateral.sub(collateral)
            ) ||
            collateral.lt(Fixed6Lib.from(-1, _liquidationFee(context)))
        )) { if (LOG_REVERTS) console.log("MarketInvalidProtectionError"); revert MarketInvalidProtectionError(); }

        if (
            msg.sender != account &&                                                                        // sender is operating on own account
            !IMarketFactory(address(factory())).operators(account, msg.sender) &&                           // sender is operating on own account
            !protected &&                                                                                   // sender is liquidating this account
            !(newOrder.isEmpty() && context.local.collateral.isZero() && collateral.gt(Fixed6Lib.ZERO))     // sender is repaying shortfall for this account
        ) { if (LOG_REVERTS) console.log("MarketOperatorNotAllowedError"); revert MarketOperatorNotAllowedError(); }

        if (context.currentTimestamp - context.latestVersion.timestamp >= context.riskParameter.staleAfter)
            { if (LOG_REVERTS) console.log("MarketStalePriceError"); revert MarketStalePriceError(); }

        if (context.marketParameter.closed && newOrder.increasesPosition())
            { if (LOG_REVERTS) console.log("MarketClosedError"); revert MarketClosedError(); }

        if (context.currentPosition.global.maker.gt(context.riskParameter.makerLimit))
            { if (LOG_REVERTS) console.log("MarketMakerOverLimitError"); revert MarketMakerOverLimitError(); }

        if (!context.currentPosition.local.singleSided())
            { if (LOG_REVERTS) console.log("MarketNotSingleSidedError"); revert MarketNotSingleSidedError(); }

        if (!_collateralized(context, context.currentPosition.local))
            { if (LOG_REVERTS) console.log("MarketInsufficientCollateralizationError2"); revert MarketInsufficientCollateralizationError(); }

        if (!protected && context.global.currentId > context.latestPosition.global.id + context.protocolParameter.maxPendingIds)
            { if (LOG_REVERTS) console.log("MarketExceedsPendingIdLimitError"); revert MarketExceedsPendingIdLimitError(); }

        if (!protected && !_collateralized(context, context.latestPosition.local))
            { if (LOG_REVERTS) console.log("MarketInsufficientCollateralizationError1"); revert MarketInsufficientCollateralizationError(); }

        for (uint256 id = context.latestPosition.local.id + 1; id < context.local.currentId; id++)
            if (!protected && !_collateralized(context, _pendingPositions[account][id].read()))
                { if (LOG_REVERTS) console.log("MarketInsufficientCollateralizationError3"); revert MarketInsufficientCollateralizationError(); }

        if (
            !protected &&
            (context.local.protection > context.latestPosition.local.timestamp) &&
            !newOrder.isEmpty()
        ) { if (LOG_REVERTS) console.log("MarketProtectedError"); revert MarketProtectedError(); }

        if (
            !protected &&
            !context.marketParameter.closed &&
            (!context.marketParameter.makerCloseAlways || newOrder.increasesMaker()) &&
            (!context.marketParameter.takerCloseAlways || newOrder.increasesTaker()) &&
            newOrder.efficiency.lt(Fixed6Lib.ZERO) &&
            context.currentPosition.global.efficiency().lt(context.riskParameter.efficiencyLimit)
        ) { if (LOG_REVERTS) console.log("MarketEfficiencyUnderLimitError"); revert MarketEfficiencyUnderLimitError(); }

        if (
            !protected &&
            !context.marketParameter.closed &&
            (!context.marketParameter.makerCloseAlways || newOrder.increasesMaker()) &&
            (!context.marketParameter.takerCloseAlways || newOrder.increasesTaker()) &&
            context.currentPosition.global.socialized() &&
            newOrder.decreasesLiquidity()
        ) { if (LOG_REVERTS) console.log("MarketInsufficientLiquidityError"); revert MarketInsufficientLiquidityError(); }

        if (!protected && collateral.lt(Fixed6Lib.ZERO) && context.local.collateral.lt(Fixed6Lib.ZERO))
            { if (LOG_REVERTS) console.log("MarketInsufficientCollateralError"); revert MarketInsufficientCollateralError(); }
    }

    function _liquidationFee(Context memory context) private view returns (UFixed6) {
        return context.latestPosition.local
            .liquidationFee(context.latestVersion, context.riskParameter)
            .min(UFixed6Lib.from(token.balanceOf()));
    }

    function _collateralized(Context memory context, Position memory active) private pure returns (bool) {
        return active.collateralized(context.latestVersion, context.riskParameter, context.local.collateral);
    }

    function _updateRiskParameter(RiskParameter memory newRiskParameter) private {
        _riskParameter.store(newRiskParameter);
        emit RiskParameterUpdated(newRiskParameter);
    }

    function _oracleVersion() private view returns (OracleVersion memory latestVersion, uint256 currentTimestamp) {
        (latestVersion, currentTimestamp) = oracle.status();
        _transform(latestVersion);
    }

    function _oracleVersionAt(uint256 timestamp) private view returns (OracleVersion memory oracleVersion) {
        oracleVersion = oracle.at(timestamp);
        _transform(oracleVersion);
    }

    function _oracleVersionAtPosition(
        Context memory context,
        Position memory toPosition
    ) private view returns (OracleVersion memory oracleVersion) {
        oracleVersion = _oracleVersionAt(toPosition.timestamp);
        if (!oracleVersion.valid) oracleVersion.price = context.global.latestPrice;
    }

    function _transform(OracleVersion memory oracleVersion) private view {
        if (address(payoff) != address(0)) oracleVersion.price = payoff.payoff(oracleVersion.price);
    }

    modifier onlyCoordinator {
        if (msg.sender != coordinator && msg.sender != factory().owner()) revert MarketNotCoordinatorError();
        _;
    }

    // Debug
    function _startGas(Context memory context, string memory message) private view {
        if (!GAS_PROFILE) return;
        context.gasCounterMessage = message;
        context.gasCounter = gasleft();
    }

    function _endGas(Context memory context) private view {
        if (!GAS_PROFILE) return;
        uint256 endGas = gasleft();
        console.log(context.gasCounterMessage,  context.gasCounter - endGas);
    }
}
