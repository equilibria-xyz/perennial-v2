// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "@equilibria/root-v2/contracts/Instance.sol";
import "./interfaces/IMarket.sol";
import "./interfaces/IMarketFactory.sol";
import "hardhat/console.sol";

// TODO: make accumulate work with latestPrice when invalid version

/**
 * @title Market
 * @notice Manages logic and state for a single market market.
 * @dev Cloned by the Factory contract to launch new market markets.
 */
contract Market is IMarket, Instance {
    bool private constant GAS_PROFILE = false;

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
        reward = definition_.reward;
        oracle = definition_.oracle;
        payoff = definition_.payoff;
        _updateRiskParameter(riskParameter_);
    }

    function update0(address account, Fixed6 collateral) external whenNotPaused {
        CurrentContext memory context = _loadContext(account, true);
        _updateInternal(
            context,
            account,
            context.accountPendingPosition.maker,
            context.accountPendingPosition.long,
            context.accountPendingPosition.short,
            collateral
        );
    }

    function update(
        address account,
        UFixed6 newMaker,
        UFixed6 newLong,
        UFixed6 newShort,
        Fixed6 collateral
    ) external whenNotPaused {
        CurrentContext memory context = _loadContext(account, true);
        _updateInternal(context, account, newMaker, newLong, newShort, collateral);
    }

    function _updateInternal(
        CurrentContext memory context,
        address account,
        UFixed6 newMaker,
        UFixed6 newLong,
        UFixed6 newShort,
        Fixed6 collateral
    ) private {
        _settle(context, account);
        _sync(context, account);
        _update(context, account, newMaker, newLong, newShort, collateral);
        _saveContext(context, account);
    }

    function updateBeneficiary(address newBeneficiary) external onlyOwner {
        beneficiary = newBeneficiary;
        emit BeneficiaryUpdated(newBeneficiary);
    }

    function updateParameter(MarketParameter memory newParameter) external onlyOwner {
        if (newParameter.oracleFee.add(newParameter.riskFee).gt(UFixed6Lib.ONE))
            revert MarketInvalidParameterError();

        _parameter.store(newParameter);
        emit ParameterUpdated(newParameter);
    }

    function updateRiskParameter(RiskParameter memory newRiskParameter) external onlyCoordinator {
        _updateRiskParameter(newRiskParameter);
    }

    function updateReward(Token18 newReward) public onlyOwner {
        if (!reward.eq(Token18Lib.ZERO)) revert MarketRewardAlreadySetError();
        reward = newReward;
        emit RewardUpdated(newReward);
    }

    function claimProtocolFee() external {
        Global memory newGlobal = _global.read();

        address receiver = address(IMarketFactory(address(factory())).treasury());
        token.push(receiver, UFixed18Lib.from(newGlobal.protocolFee));
        emit FeeClaimed(receiver, newGlobal.protocolFee);

        newGlobal.protocolFee = UFixed6Lib.ZERO;
        _global.store(newGlobal);
    }

    function claimOracleFee() external {
        Global memory newGlobal = _global.read();

        address receiver = address(IMarketFactory(address(factory())).oracleFactory());
        token.push(receiver, UFixed18Lib.from(newGlobal.oracleFee));
        emit FeeClaimed(receiver, newGlobal.oracleFee);

        newGlobal.oracleFee = UFixed6Lib.ZERO;
        _global.store(newGlobal);
    }

    function claimRiskFee() external onlyCoordinator {
        Global memory newGlobal = _global.read();

        token.push(coordinator, UFixed18Lib.from(newGlobal.riskFee));
        emit FeeClaimed(coordinator, newGlobal.riskFee);

        newGlobal.riskFee = UFixed6Lib.ZERO;
        _global.store(newGlobal);
    }

    function claimDonation() external {
        Global memory newGlobal = _global.read();

        token.push(beneficiary, UFixed18Lib.from(newGlobal.donation));
        emit FeeClaimed(beneficiary, newGlobal.donation);

        newGlobal.donation = UFixed6Lib.ZERO;
        _global.store(newGlobal);
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
        CurrentContext memory context,
        address account,
        UFixed6 newMaker,
        UFixed6 newLong,
        UFixed6 newShort,
        Fixed6 collateral
    ) private {
        _startGas(context, "_update before-update-after: %s");

        // before -- TODO: clean this up and move to invariant
        if (context.local.liquidation > context.accountPosition.timestamp) { // locked for liquidation
            if (
                !context.accountPendingPosition.maker.eq(newMaker) ||
                !context.accountPendingPosition.long.eq(newLong) ||
                !context.accountPendingPosition.short.eq(newShort)
            ) revert MarketInLiquidationError();  // only revert if position changed
        } else if (!_positionSolvent(context, context.accountPosition)) {  // process liquidation and lock if insolvent
            context.liquidation = true;
            context.local.liquidation = context.currentTimestamp;
            emit Liquidation(account, msg.sender, context.currentTimestamp);
        }

        // update position
        if (context.currentTimestamp > context.accountPendingPosition.timestamp) context.local.currentId++;
        Order memory newOrder = context.accountPendingPosition.update(
            context.local.currentId,
            context.currentTimestamp,
            newMaker,
            newLong,
            newShort
        );
        if (context.currentTimestamp > context.pendingPosition.timestamp) context.global.currentId++;
        context.pendingPosition.update(context.global.currentId, context.currentTimestamp, newOrder);

        // update fee
        newOrder.registerFee(context.latestVersion, context.protocolParameter, context.riskParameter);
        context.accountPendingPosition.registerFee(newOrder);
        context.pendingPosition.registerFee(newOrder);

        // update collateral
        Fixed6 collateralAmount = collateral.eq(Fixed6Lib.MIN) ? context.local.collateral.mul(Fixed6Lib.NEG_ONE) : collateral;
        context.local.update(collateralAmount);
        context.accountPendingPosition.update(collateralAmount);

        // after
        _checkOperator(context, account, newOrder, collateral);
        _checkPosition(context, newOrder);
        _checkCollateral(context, account, collateral);

        _endGas(context);

        _startGas(context, "_update fund-events: %s");

        // fund
        if (collateralAmount.sign() == 1) token.pull(msg.sender, UFixed18Lib.from(collateralAmount.abs()));
        if (collateralAmount.sign() == -1) token.push(msg.sender, UFixed18Lib.from(collateralAmount.abs()));

        // events
        emit Updated(account, context.currentTimestamp, newMaker, newLong, newShort, collateral);

        _endGas(context);
    }

    function _loadContext(address account, bool request) private returns (CurrentContext memory context) {
        _startGas(context, "_loadContext: %s");

        // parameters
        context.protocolParameter = IMarketFactory(address(factory())).parameter();
        context.marketParameter = _parameter.read();
        context.riskParameter = _riskParameter.read();

        // global
        context.global = _global.read();
        context.pendingPosition = _pendingPosition[context.global.currentId].read();
        context.position = _position.read();

        // account
        context.local = _locals[account].read();
        context.accountPendingPosition = _pendingPositions[account][context.local.currentId].read();
        context.accountPosition = _positions[account].read();

        // oracle
        (context.latestVersion, context.currentTimestamp) = request ? _oracleVersionRequest() : _oracleVersion();
        context.positionVersion = _oracleVersionAt(context.position.timestamp);

        // after
        _endGas(context);
    }

    function _saveContext(CurrentContext memory context, address account) private {
        _startGas(context, "_saveContext: %s");

        // global
        _global.store(context.global);
        if (context.global.currentId > context.position.id)
            _pendingPosition[context.global.currentId].store(context.pendingPosition);
        _position.store(context.position);

        // account
        _locals[account].store(context.local);
        if (context.local.currentId > context.accountPosition.id)
            _pendingPositions[account][context.local.currentId].store(context.accountPendingPosition);
        _positions[account].store(context.accountPosition);

        _endGas(context);
    }

    function _settle(CurrentContext memory context, address account) private {
        _startGas(context, "_settle: %s");

        Position memory nextPosition;

        while (
            context.global.currentId != context.position.id &&
            (nextPosition = _pendingPosition[context.position.id + 1].read()).ready(context.latestVersion)
        ) _processPosition(context, nextPosition);

        while (
            context.local.currentId != context.accountPosition.id &&
            (nextPosition = _pendingPositions[account][context.accountPosition.id + 1].read()).ready(context.latestVersion)
        ) {
            Fixed6 previousDelta = _pendingPositions[account][context.accountPosition.id].read().delta;
            _processPositionAccount(context, nextPosition);
            nextPosition.collateral = context.local.collateral
                .sub(context.accountPendingPosition.delta.sub(previousDelta)) // deposits happen after snapshot point
                .add(Fixed6Lib.from(nextPosition.fee));                       // position fee happens after snapshot point
            _pendingPositions[account][nextPosition.id].store(nextPosition);
        }

        _endGas(context);
    }

    function _sync(CurrentContext memory context, address account) private {
        _startGas(context, "_sync: %s");

        Position memory nextPosition;

        if (context.latestVersion.timestamp > context.position.timestamp) {
            nextPosition = _pendingPosition[context.position.id].read();
            nextPosition.timestamp = context.latestVersion.timestamp;
            nextPosition.fee = UFixed6Lib.ZERO;
            _processPosition(context, nextPosition);
        }
        if (context.latestVersion.timestamp > context.accountPosition.timestamp) {
            nextPosition = _pendingPositions[account][context.accountPosition.id].read();
            nextPosition.timestamp = context.latestVersion.timestamp;
            nextPosition.fee = UFixed6Lib.ZERO;
            _processPositionAccount(context, nextPosition);
        }

        _endGas(context);
    }

    function _processPosition(CurrentContext memory context, Position memory newPosition) private {
        Version memory version = _versions[context.position.timestamp].read();
        OracleVersion memory oracleVersion = _oracleVersionAt(newPosition.timestamp);
        if (!oracleVersion.valid) return; // skip processing if invalid

        UFixed6 accumulatedFee = version.accumulate(
            context.global,
            context.position,
            newPosition,
            context.positionVersion,
            oracleVersion,
            context.marketParameter,
            context.riskParameter
        );
        context.position.update(newPosition);
        context.global.incrementFees(
            accumulatedFee,
            newPosition.keeper,
            context.marketParameter,
            context.protocolParameter
        );
        context.positionVersion = oracleVersion;
        _versions[newPosition.timestamp].store(version);
    }

    function _processPositionAccount(CurrentContext memory context, Position memory newPosition) private view {
        Version memory version = _versions[newPosition.timestamp].read();
        if (!version.valid) return; // skip processing if invalid

        context.local.accumulate(
            context.accountPosition,
            newPosition,
            _versions[context.accountPosition.timestamp].read(),
            version
        );
        context.accountPosition.update(newPosition);
    }

    function _checkOperator(
        CurrentContext memory context,
        address account,
        Order memory newOrder,
        Fixed6 collateral
    ) private view {
        // compute liquidation fee
        UFixed6 liquidationFee = context.accountPosition // TODO: cleanup
            .liquidationFee(context.latestVersion, context.riskParameter, context.protocolParameter)
            .min(UFixed6Lib.from(token.balanceOf()));

        if (account == msg.sender) return;                                                                      // sender is operating on own account
        if (IMarketFactory(address(factory())).operators(account, msg.sender)) return;                          // sender is operator enabled for this account
        if (newOrder.isEmpty() && context.local.collateral.isZero() && collateral.gt(Fixed6Lib.ZERO)) return;   // sender is repaying shortfall for this account
        if (context.liquidation && collateral.gte(Fixed6Lib.from(-1, liquidationFee))) return;                  // sender is liquidating this account
        revert MarketOperatorNotAllowed();
    }

    function _checkPosition(CurrentContext memory context, Order memory newOrder) private pure {
        if (context.marketParameter.closed && newOrder.increasesPosition()) revert MarketClosedError();
        if (context.liquidation && (
            !context.accountPendingPosition.magnitude().isZero() &&  // position is closed
            !newOrder.isEmpty()                                      // position is not updated
        )) revert MarketMustLiquidateError();
        // TODO: if locked for liquidation -> revert if position changed?
        if (
            !context.liquidation &&
            !context.marketParameter.closed && // TODO: remove?
            context.pendingPosition.socialized() &&
            newOrder.decreasesLiquidity()
        ) revert MarketInsufficientLiquidityError();
        if (context.pendingPosition.maker.gt(context.riskParameter.makerLimit)) revert MarketMakerOverLimitError();
        if (!context.accountPendingPosition.singleSided()) revert MarketNotSingleSidedError();
        if (context.global.currentId > context.position.id + context.protocolParameter.maxPendingIds)
            revert MarketExceedsPendingIdLimitError(); // TODO: add liquidation check here too?
    }

    function _checkCollateral(CurrentContext memory context, address account, Fixed6 collateral) private view {
        if (
            !context.liquidation &&
            context.local.collateral.gt(Fixed6Lib.ZERO) &&
            context.local.collateral.lt(Fixed6Lib.from(context.protocolParameter.minCollateral)) &&
            !collateral.isZero() // TODO: remove? -- allows settling when in under minCollateral if collateral delta is zero
        ) revert MarketCollateralUnderLimitError(); // TODO: a lot of situations can trigger this

        UFixed6 maintenanceAmount =
            context.accountPendingPosition.maintenance(context.latestVersion, context.riskParameter);
        for (uint256 id = context.accountPosition.id + 1; id < context.local.currentId; id++)
            maintenanceAmount = maintenanceAmount
                .max(_pendingPositions[account][id].read().maintenance(context.latestVersion, context.riskParameter));

        if (
            !context.liquidation &&
            context.local.collateral.lt(Fixed6Lib.from(maintenanceAmount)) &&
            (collateral.sign() < 0 || !maintenanceAmount.isZero()) // TODO: remove? -- allows settling when in shortfall w/ no position
        ) revert MarketInsufficientCollateralError();
    }

    function _positionSolvent(CurrentContext memory context, Position memory checkPosition) private pure returns (bool) {
        return context.local.collateral
            .max(Fixed6Lib.ZERO) // shortfall is considered solvent for 0-position
            .gte(Fixed6Lib.from(checkPosition.maintenance(context.latestVersion, context.riskParameter)));
    }

    function _updateRiskParameter(RiskParameter memory newRiskParameter) private {
        _riskParameter.store(newRiskParameter);
        emit RiskParameterUpdated(newRiskParameter);
    }

    function _oracleVersionRequest() private returns (OracleVersion memory latestVersion, uint256 currentTimestamp) {
        (latestVersion, currentTimestamp) = oracle.request();
        _transform(latestVersion);
    }

    function _oracleVersion() private view returns (OracleVersion memory latestVersion, uint256 currentTimestamp) {
        (latestVersion, currentTimestamp) = (oracle.latest(), oracle.current()); // TODO: batch call?
        _transform(latestVersion);
    }

    function _oracleVersionAt(uint256 timestamp) private view returns (OracleVersion memory oracleVersion) {
        oracleVersion = oracle.at(timestamp);
        _transform(oracleVersion);
    }

    function _transform(OracleVersion memory oracleVersion) private view {
        if (address(payoff) != address(0)) oracleVersion.price = payoff.payoff(oracleVersion.price);
    }

    modifier onlyCoordinator {
        if (msg.sender != coordinator && msg.sender != factory().owner()) revert MarketNotCoordinatorError();
        _;
    }

    modifier onlyBeneficiary {
        if (msg.sender != beneficiary && msg.sender != factory().owner()) revert MarketNotBeneficiaryError();
        _;
    }

    // Debug
    function _startGas(CurrentContext memory context, string memory message) private view {
        if (!GAS_PROFILE) return;
        context.gasCounterMessage = message;
        context.gasCounter = gasleft();
    }

    function _endGas(CurrentContext memory context) private view {
        if (!GAS_PROFILE) return;
        uint256 endGas = gasleft();
        console.log(context.gasCounterMessage,  context.gasCounter - endGas);
    }
}
