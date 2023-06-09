// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "@equilibria/root/control/unstructured/UInitializable.sol";
import "@equilibria/root/control/unstructured/UOwnable.sol";
import "./interfaces/IMarket.sol";
import "./interfaces/IFactory.sol";
import "hardhat/console.sol";

/**
 * @title Market
 * @notice Manages logic and state for a single market market.
 * @dev Cloned by the Factory contract to launch new market markets.
 */
contract Market is IMarket, UInitializable, UOwnable {
    bool private constant GAS_PROFILE = false;

    /// @dev The name of the market
    string public name;

    /// @dev The symbol of the market
    string public symbol;

    /// @dev The protocol factory
    IFactory public factory;

    /// @dev ERC20 stablecoin for collateral
    Token18 public token;

    /// @dev ERC20 token for reward
    Token18 public reward;

    /// @dev Treasury of the market, collects fees
    address public treasury;

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
        MarketParameter calldata parameter_
    ) external initializer(1) {
        __UOwnable__initialize();

        factory = IFactory(msg.sender);
        name = definition_.name;
        symbol = definition_.symbol;
        token = definition_.token;
        reward = definition_.reward;
        updateParameter(parameter_);
    }

    function settle(address account) external {
        CurrentContext memory context = _loadContext(account);
        if (context.protocolParameter.paused) revert MarketPausedError();

        _settle(context, account);
        _sync(context, account);
        _liquidate(context, account);
        _saveContext(context, account);
    }

    function update(
        address account,
        UFixed6 newMaker,
        UFixed6 newLong,
        UFixed6 newShort,
        Fixed6 collateral
    ) external {
        CurrentContext memory context = _loadContext(account);
        if (context.protocolParameter.paused) revert MarketPausedError();

        _checkOperator(context, account, newMaker, newLong, newShort, collateral);
        _settle(context, account);
        _sync(context, account);
        _update(context, account, newMaker, newLong, newShort, collateral, false);
        _saveContext(context, account);
    }

    function updateTreasury(address newTreasury) external onlyOwner {
        treasury = newTreasury;
        emit TreasuryUpdated(newTreasury);
    }

    function updateParameter(MarketParameter memory newParameter) public onlyOwner {
        _parameter.store(newParameter);
        emit ParameterUpdated(newParameter);
    }

    function claimFee() external {
        Global memory newGlobal = _global.read();

        if (msg.sender == treasury) {
            token.push(msg.sender, UFixed18Lib.from(newGlobal.marketFee));
            emit FeeClaimed(msg.sender, newGlobal.marketFee);
            newGlobal.marketFee = UFixed6Lib.ZERO;
        }

        if (msg.sender == factory.treasury()) {
            token.push(msg.sender, UFixed18Lib.from(newGlobal.protocolFee));
            emit FeeClaimed(msg.sender, newGlobal.protocolFee);
            newGlobal.protocolFee = UFixed6Lib.ZERO;
        }

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

    function _liquidate(CurrentContext memory context, address account) private {
        // before
        UFixed6 maintenance = context.marketParameter.closed ?
            UFixed6Lib.ZERO :
            context.accountPosition.maintenance(context.latestVersion, context.marketParameter);

        if (context.local.collateral.max(Fixed6Lib.ZERO).gte(Fixed6Lib.from(maintenance)) ||
            context.local.liquidation > context.accountPosition.version) return;

        // compute reward
        UFixed6 liquidationFee = context.accountPosition.liquidationFee(
            context.latestVersion,
            context.marketParameter,
            context.protocolParameter
        ).min(UFixed6Lib.from(token.balanceOf()));

        // close position
        _update(context, account, UFixed6Lib.ZERO, UFixed6Lib.ZERO, UFixed6Lib.ZERO, Fixed6Lib.from(-1, liquidationFee), true);
        context.local.liquidation = context.accountPendingPosition.version;

        emit Liquidation(account, msg.sender, liquidationFee);
    }

    function _update(
        CurrentContext memory context,
        address account,
        UFixed6 newMaker,
        UFixed6 newLong,
        UFixed6 newShort,
        Fixed6 collateral,
        bool force
    ) private {
        _startGas(context, "_update before-update-after: %s");

        // before
        if (context.local.liquidation > context.accountPosition.version) revert MarketInLiquidationError();
        if (context.marketParameter.closed && !newMaker.add(newLong).add(newShort).isZero()) revert MarketClosedError();

        // update position
        if (context.currentVersion > context.accountPendingPosition.version) context.local.currentId++;
        Order memory newOrder = context.accountPendingPosition.update(
            context.local.currentId,
            context.currentVersion,
            newMaker,
            newLong,
            newShort,
            context.latestVersion,
            context.marketParameter
        );
        if (context.currentVersion > context.pendingPosition.version) context.global.currentId++;
        context.pendingPosition.update(context.global.currentId, context.currentVersion, newOrder);

        // update collateral
        Fixed6 collateralAmount = collateral.eq(Fixed6Lib.MIN) ? context.local.collateral.mul(Fixed6Lib.NEG_ONE) : collateral;
        context.local.update(collateralAmount);
        context.accountPendingPosition.update(collateralAmount);

        // after
        if (!force) _checkPosition(context);
        if (!force) _checkCollateral(context);

        _endGas(context);

        _startGas(context, "_update fund-events: %s");

        // fund
        if (collateralAmount.sign() == 1) token.pull(msg.sender, UFixed18Lib.from(collateralAmount.abs()));
        if (collateralAmount.sign() == -1) token.push(msg.sender, UFixed18Lib.from(collateralAmount.abs()));

        // events
        emit Updated(account, context.currentVersion, newMaker, newLong, newShort, collateral);

        _endGas(context);
    }

    function _loadContext(address account) private returns (CurrentContext memory context) {
        _startGas(context, "_loadContext: %s");

        // parameters
        context.protocolParameter = factory.parameter();
        context.marketParameter = _parameter.read();

        // global
        context.global = _global.read();
        context.pendingPosition = _pendingPosition[context.global.currentId].read();
        context.position = _position.read();

        // account
        context.local = _locals[account].read();
        context.accountPendingPosition = _pendingPositions[account][context.local.currentId].read();
        context.accountPosition = _positions[account].read();

        // oracle
        (context.latestVersion, context.currentVersion) = _oracleVersion(context.marketParameter);
        context.positionVersion = _oracleVersionAt(context.marketParameter, context.position.version);

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

        if (context.latestVersion.version > context.position.version) {
            nextPosition = _pendingPosition[context.position.id].read();
            nextPosition.version = context.latestVersion.version;
            nextPosition.fee = UFixed6Lib.ZERO;
            _processPosition(context, nextPosition);
        }
        if (context.latestVersion.version > context.accountPosition.version) {
            nextPosition = _pendingPositions[account][context.accountPosition.id].read();
            nextPosition.version = context.latestVersion.version;
            nextPosition.fee = UFixed6Lib.ZERO;
            _processPositionAccount(context, nextPosition);
        }

        _endGas(context);
    }

    function _processPosition(CurrentContext memory context, Position memory newPosition) private {
        Version memory version = _versions[context.position.version].read();
        OracleVersion memory oracleVersion = _oracleVersionAt(context.marketParameter, newPosition.version);
        if (!oracleVersion.valid) return; // skip processing if invalid

        UFixed6 accumulatedFee = version.accumulate(
            context.position,
            newPosition,
            context.positionVersion,
            oracleVersion,
            context.protocolParameter,
            context.marketParameter
        );
        context.position.update(newPosition);
        context.global.incrementFees(accumulatedFee, context.protocolParameter);
        context.positionVersion = oracleVersion;
        _versions[newPosition.version].store(version);
    }

    function _processPositionAccount(CurrentContext memory context, Position memory newPosition) private view {
        Version memory version = _versions[newPosition.version].read();
        if (!version.valid) return; // skip processing if invalid

        context.local.accumulate(
            context.accountPosition,
            newPosition,
            _versions[context.accountPosition.version].read(),
            version
        );
        context.accountPosition.update(newPosition);
    }

    function _checkOperator(
        CurrentContext memory context,
        address account,
        UFixed6 newMaker,
        UFixed6 newLong,
        UFixed6 newShort,
        Fixed6 collateral
    ) private view {
        if (account == msg.sender) return;                  // sender is operating on own account
        if (factory.operators(account, msg.sender)) return; // sender is operator enabled for this account
        if (
            context.accountPendingPosition.maker.eq(newMaker) &&
            context.accountPendingPosition.long.eq(newLong) &&
            context.accountPendingPosition.short.eq(newShort) &&
            context.local.collateral.sign() == -1 && context.local.collateral.add(collateral).isZero()
        ) return; // sender is repaying shortfall for this account
        revert MarketOperatorNotAllowed();
    }

    function _checkPosition(CurrentContext memory context) private pure {
        if (
            !context.marketParameter.closed &&
            context.pendingPosition.socialized() &&
            context.accountPendingPosition.sub(context.accountPosition).decreasesLiquidity()
        ) revert MarketInsufficientLiquidityError();
        if (context.pendingPosition.maker.gt(context.marketParameter.makerLimit)) revert MarketMakerOverLimitError();
        if (!context.accountPendingPosition.singleSided()) revert MarketNotSingleSidedError();
        if (context.global.currentId > context.position.id + context.protocolParameter.maxPendingIds)
            revert MarketExceedsPendingIdLimitError();
    }

    function _checkCollateral(CurrentContext memory context) private pure {
        if (context.local.collateral.sign() == -1) revert MarketInDebtError();

        UFixed6 boundedCollateral = UFixed6Lib.from(context.local.collateral);

        if (!context.local.collateral.isZero() && boundedCollateral.lt(context.protocolParameter.minCollateral))
            revert MarketCollateralUnderLimitError();

        UFixed6 maintenanceAmount =
            context.accountPosition.maintenance(context.latestVersion, context.marketParameter)
                .max(context.accountPendingPosition.maintenance(context.latestVersion, context.marketParameter));

        if (maintenanceAmount.gt(boundedCollateral)) revert MarketInsufficientCollateralError();
    }

    function at(uint256 version) public view returns (OracleVersion memory) {
        MarketParameter memory marketParameter = _parameter.read();
        return _oracleVersionAt(marketParameter, version);
    }

    function _oracleVersion(
        MarketParameter memory marketParameter
    ) private returns (OracleVersion memory latestVersion, uint256 currentVersion) {
        (latestVersion, currentVersion) = marketParameter.oracle.sync();
        _transform(marketParameter, latestVersion);
    }

    function _oracleVersionAt(
        MarketParameter memory marketParameter,
        uint256 version
    ) private view returns (OracleVersion memory oracleVersion) {
        oracleVersion = marketParameter.oracle.at(version);
        _transform(marketParameter, oracleVersion);
    }

    function _transform(MarketParameter memory marketParameter, OracleVersion memory oracleVersion) private pure {
        if (address(marketParameter.payoff) != address(0))
            oracleVersion.price = marketParameter.payoff.payoff(oracleVersion.price);
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
