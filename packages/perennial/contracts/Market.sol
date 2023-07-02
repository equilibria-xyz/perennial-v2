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
        reward = definition_.reward;
        oracle = definition_.oracle;
        payoff = definition_.payoff;
        _updateRiskParameter(riskParameter_);
    }

    function update(
        address account,
        UFixed6 newMaker,
        UFixed6 newLong,
        UFixed6 newShort,
        Fixed6 collateral,
        bool protect
    ) external whenNotPaused {
        CurrentContext memory context = _loadContext(account);
        _settle(context, account);
        _sync(context, account);
        _update(context, account, newMaker, newLong, newShort, collateral, protect);
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
        Fixed6 collateral,
        bool protect
    ) private {
        _startGas(context, "_update before-update-after: %s");

        // update position
        if (context.currentTimestamp > context.accountPendingPosition.timestamp) context.local.currentId++;
        Order memory newOrder = context.accountPendingPosition
            .update(context.local.currentId, context.currentTimestamp, newMaker, newLong, newShort);
        if (context.currentTimestamp > context.pendingPosition.timestamp) context.global.currentId++;
        context.pendingPosition.update(context.global.currentId, context.currentTimestamp, newOrder);

        // update fee
        newOrder.registerFee(context.latestVersion, context.protocolParameter, context.riskParameter);
        context.accountPendingPosition.registerFee(newOrder);
        context.pendingPosition.registerFee(newOrder);

        // update collateral
        if (collateral.eq(Fixed6Lib.MIN)) collateral = context.local.collateral.mul(Fixed6Lib.NEG_ONE);
        context.local.update(collateral);
        context.accountPendingPosition.update(collateral);

        // protect account
        bool protected = context.local.protect(context.accountPosition, context.currentTimestamp, protect);

        // request version
        if (!newOrder.isEmpty()) oracle.request();

        // after
        _invariant(context, account, newOrder, collateral, protected);

        _endGas(context);

        _startGas(context, "_update fund-events: %s");

        // fund
        if (collateral.sign() == 1) token.pull(msg.sender, UFixed18Lib.from(collateral.abs()));
        if (collateral.sign() == -1) token.push(msg.sender, UFixed18Lib.from(collateral.abs()));

        // events
        emit Updated(account, context.currentTimestamp, newMaker, newLong, newShort, collateral, protect);

        _endGas(context);
    }

    function _loadContext(address account) private view returns (CurrentContext memory context) {
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
        (context.latestVersion, context.currentTimestamp) = _oracleVersion();
        context.positionVersion = _oracleVersionAtPosition(context, context.position);

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
            nextPosition.keeper = UFixed6Lib.ZERO;
            _processPosition(context, nextPosition);
        }
        if (context.latestVersion.timestamp > context.accountPosition.timestamp) {
            nextPosition = _pendingPositions[account][context.accountPosition.id].read();
            nextPosition.timestamp = context.latestVersion.timestamp;
            nextPosition.fee = UFixed6Lib.ZERO;
            nextPosition.keeper = UFixed6Lib.ZERO;
            _processPositionAccount(context, nextPosition);
        }

        _endGas(context);
    }

    function _processPosition(CurrentContext memory context, Position memory newPosition) private {
        Version memory version = _versions[context.position.timestamp].read();
        OracleVersion memory oracleVersion = _oracleVersionAtPosition(context, newPosition); // TODO: seems weird some logic is in here
        if (!oracleVersion.valid) newPosition.invalidate(context.position); // TODO: combine this with sync logic?

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
        context.global.update(oracleVersion.price);
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
        if (!version.valid) newPosition.invalidate(context.accountPosition);

        context.local.accumulate(
            context.accountPosition,
            newPosition,
            _versions[context.accountPosition.timestamp].read(),
            version
        );
        context.accountPosition.update(newPosition);
    }

    function _invariant(
        CurrentContext memory context,
        address account,
        Order memory newOrder,
        Fixed6 collateral,
        bool protected
    ) private view {
        if (
            msg.sender != account &&                                                                        // sender is operating on own account
            !IMarketFactory(address(factory())).operators(account, msg.sender) &&                           // sender is operating on own account
            !(newOrder.isEmpty() && context.local.collateral.isZero() && collateral.gt(Fixed6Lib.ZERO)) &&  // sender is repaying shortfall for this account
            !(
                protected &&
                collateral.gte(Fixed6Lib.from(-1, _liquidationFee(context))) &&
                !_collateralized(context, context.accountPosition)
            )                                                                                               // sender is liquidating this account
        ) { if (LOG_REVERTS) console.log("MarketOperatorNotAllowed"); revert MarketOperatorNotAllowed(); }

        if (context.marketParameter.closed && newOrder.increasesPosition())
            { if (LOG_REVERTS) console.log("MarketClosedError"); revert MarketClosedError(); }

        if (protected && (!context.accountPendingPosition.magnitude().isZero()))
            { if (LOG_REVERTS) console.log("MarketMustCloseError"); revert MarketMustCloseError(); }

        if (
            !protected &&
            (context.local.protection > context.accountPosition.timestamp) &&
            !newOrder.isEmpty()
        ) { if (LOG_REVERTS) console.log("MarketProtectedError"); revert MarketProtectedError(); }

        if (
            !protected &&
            !context.marketParameter.closed &&
            context.pendingPosition.socialized() &&
            newOrder.decreasesLiquidity()
        ) { if (LOG_REVERTS) console.log("MarketInsufficientLiquidityError"); revert MarketInsufficientLiquidityError(); }

        if (context.pendingPosition.maker.gt(context.riskParameter.makerLimit))
            { if (LOG_REVERTS) console.log("MarketMakerOverLimitError"); revert MarketMakerOverLimitError(); }

        if (!context.accountPendingPosition.singleSided())
            { if (LOG_REVERTS) console.log("MarketNotSingleSidedError"); revert MarketNotSingleSidedError(); }

        if (!protected && context.global.currentId > context.position.id + context.protocolParameter.maxPendingIds)
            { if (LOG_REVERTS) console.log("MarketExceedsPendingIdLimitError"); revert MarketExceedsPendingIdLimitError(); }

        if (!protected && !_collateralized(context, context.accountPosition))
            { if (LOG_REVERTS) console.log("MarketInsufficientCollateralizationError1"); revert MarketInsufficientCollateralizationError(); }

        if (!_collateralized(context, context.accountPendingPosition))
            { if (LOG_REVERTS) console.log("MarketInsufficientCollateralizationError2"); revert MarketInsufficientCollateralizationError(); }

        for (uint256 id = context.accountPosition.id + 1; id < context.local.currentId; id++)
            if (!protected && !_collateralized(context, _pendingPositions[account][id].read()))
                { if (LOG_REVERTS) console.log("MarketInsufficientCollateralizationError3"); revert MarketInsufficientCollateralizationError(); }

        if (!protected && context.local.belowLimit(context.protocolParameter))
            { if (LOG_REVERTS) console.log("MarketCollateralBelowLimitError"); revert MarketCollateralBelowLimitError(); }

        if (!protected && collateral.lt(Fixed6Lib.ZERO) && context.local.collateral.lt(Fixed6Lib.ZERO))
            { if (LOG_REVERTS) console.log("MarketInsufficientCollateralError"); revert MarketInsufficientCollateralError(); }
    }

    function _liquidationFee(CurrentContext memory context) private view returns (UFixed6) {
        return context.accountPosition
            .liquidationFee(context.latestVersion, context.riskParameter, context.protocolParameter)
            .min(UFixed6Lib.from(token.balanceOf()));
    }

    function _collateralized(CurrentContext memory context, Position memory active) private pure returns (bool) {
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
        CurrentContext memory context,
        Position memory toPosition
    ) private view returns (OracleVersion memory oracleVersion) {
        oracleVersion = _oracleVersion(toPosition.timestamp);
        if (!oracleVersion.valid) oracleVersion.price = context.global.latestPrice;
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
