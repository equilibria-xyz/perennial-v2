// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "@equilibria/root/control/unstructured/UInitializable.sol";
import "@equilibria/root-v2/contracts/UOwnable.sol";
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

    /// @dev Protocol and market fees collected, but not yet claimed
    FeeStorage private _fee;

    /// @dev Mapping of the historical version data
    mapping(uint256 => VersionStorage) _versions;

    /// @dev The individual state for each account
    mapping(address => AccountStorage) private _accounts;

    OrderStorage private _order;

    OrderStorage private _pendingOrder;

    mapping(address => OrderStorage) private _orders;

    mapping(address => OrderStorage) private _pendingOrders;

    MarketParameterStorage private _parameter;

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

        _settle(context);
        _liquidate(context, account);
        _saveContext(context, account);
    }

    function update(
        address account,
        UFixed6 newMaker,
        UFixed6 newLong,
        UFixed6 newShort,
        Fixed6 newCollateral
    ) external {
        CurrentContext memory context = _loadContext(account);
        if (context.protocolParameter.paused) revert MarketPausedError();

        _checkOperator(context, account, newMaker, newLong, newShort, newCollateral);
        _settle(context);
        _update(context, account, newMaker, newLong, newShort, newCollateral, false);
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
        Fee memory newFee = _fee.read();

        if (msg.sender == treasury) {
            UFixed6 feeAmount = newFee.market;
            newFee.market = UFixed6Lib.ZERO;
            token.push(msg.sender, UFixed18.wrap(UFixed6.unwrap(feeAmount) * 1e12));
            emit FeeClaimed(msg.sender, feeAmount);
        }

        if (msg.sender == factory.treasury()) {
            UFixed6 feeAmount = newFee.protocol;
            newFee.protocol = UFixed6Lib.ZERO;
            token.push(msg.sender, UFixed18.wrap(UFixed6.unwrap(feeAmount) * 1e12));
            emit FeeClaimed(msg.sender, feeAmount);
        }

        _fee.store(newFee);
    }

    function claimReward() external {
        Account memory newAccount = _accounts[msg.sender].read();

        UFixed6 rewardAmount = newAccount.reward;
        newAccount.reward = UFixed6Lib.ZERO;
        reward.push(msg.sender, UFixed18.wrap(UFixed6.unwrap(rewardAmount) * 1e12));
        emit RewardClaimed(msg.sender, rewardAmount);

        _accounts[msg.sender].store(newAccount);
    }

    function parameter() external view returns (MarketParameter memory) {
        return _parameter.read();
    }

    function order() external view returns (Order memory) {
        return _order.read();
    }

    function orders(address account) external view returns (Order memory) {
        return _orders[account].read();
    }

    function fee() external view returns (Fee memory) {
        return _fee.read();
    }

    function versions(uint256 oracleVersion) external view returns (Version memory) {
        return _versions[oracleVersion].read();
    }

    function accounts(address account) external view returns (Account memory) {
        return _accounts[account].read();
    }

    function pendingOrder() external view returns (Order memory) {
        return _pendingOrder.read();
    }

    function pendingOrders(address account) external view returns (Order memory) {
        return _pendingOrders[account].read();
    }

    function _liquidate(CurrentContext memory context, address account) private {
        // before
        UFixed6 maintenance = context.accountOrder.maintenance(context.currentOracleVersion, context.marketParameter);
        if (context.account.collateral.gte(Fixed6Lib.from(maintenance)) || context.account.liquidation) return; // cant liquidate
        if (context.marketParameter.closed) return; // cant liquidate

        // compute reward
        UFixed6 liquidationReward = context.accountOrder.liquidationFee(
            context.currentOracleVersion,
            context.marketParameter,
            context.protocolParameter
        ).min(UFixed6Lib.from(token.balanceOf()));
        Fixed6 newCollateral = context.account.collateral.sub(Fixed6Lib.from(liquidationReward));

        // close position
        _update(context, account, UFixed6Lib.ZERO, UFixed6Lib.ZERO, UFixed6Lib.ZERO, newCollateral, true);
        context.account.liquidation = true;

        emit Liquidation(account, msg.sender, liquidationReward);
    }

    function _update(
        CurrentContext memory context,
        address account,
        UFixed6 newMaker,
        UFixed6 newLong,
        UFixed6 newShort,
        Fixed6 newCollateral, //TODO: make delta
        bool force
    ) private {
        _startGas(context, "_update before-update-after: %s");

        // before
        if (context.account.liquidation) revert MarketInLiquidationError();
        if (context.marketParameter.closed && !newMaker.add(newLong).add(newShort).isZero()) revert MarketClosedError();

        // update position
        Order memory newAccountOrder = Order(context.currentOracleVersion.version + 1, newMaker, newLong, newShort);
        OrderDelta memory accountOrderDelta = newAccountOrder.sub(context.accountPendingOrder);
        context.accountPendingOrder.update(newAccountOrder);
        context.pendingOrder.update(newAccountOrder.version, accountOrderDelta);

        // update collateral
        if (newCollateral.eq(Fixed6Lib.MAX)) newCollateral = context.account.collateral;
        UFixed6 positionFee = accountOrderDelta.fee(context.currentOracleVersion, context.marketParameter);
        Fixed6 collateralAmount = context.account.update(newCollateral, positionFee);
        UFixed6 protocolFee = context.version.update(context.order, positionFee, context.marketParameter);
        context.fee.update(protocolFee, context.protocolParameter);

        // after
        if (!force) _checkPosition(context);
        if (!force) _checkCollateral(context);

        _endGas(context);

        _startGas(context, "_update fund-events: %s");

        // fund
        if (collateralAmount.sign() == 1) token.pull(msg.sender, UFixed18.wrap(UFixed6.unwrap(collateralAmount.abs()) * 1e12)); //TODO: use .to6()
        if (collateralAmount.sign() == -1) token.push(msg.sender, UFixed18.wrap(UFixed6.unwrap(collateralAmount.abs()) * 1e12));

        // events
        emit Updated(account, context.currentOracleVersion.version, newMaker, newLong, newShort, newCollateral);

        _endGas(context);
    }

    function _loadContext(address account) private returns (CurrentContext memory context) {
        _startGas(context, "_loadContext: %s");

        // parameters
        context.protocolParameter = factory.parameter();
        context.marketParameter = _parameter.read();

        // state
        context.currentOracleVersion = _sync(context.marketParameter);
        context.pendingOrder = _pendingOrder.read();
        context.order = _order.read();
        context.fee = _fee.read();
        context.accountPendingOrder = _pendingOrders[account].read();
        context.accountOrder = _orders[account].read();
        context.account = _accounts[account].read();
        context.version = _versions[context.pendingOrder.version].read();

        // after
        _endGas(context);
    }

    function _saveContext(CurrentContext memory context, address account) private {
        _startGas(context, "_saveContext: %s");

        // state
        _pendingOrder.store(context.pendingOrder);
        _order.store(context.order);
        _fee.store(context.fee);
        _pendingOrders[account].store(context.accountPendingOrder);
        _orders[account].store(context.accountOrder);
        _accounts[account].store(context.account);
        _versions[context.pendingOrder.version].store(context.version);

        _endGas(context);
    }

    function _settle(CurrentContext memory context) private {
        _startGas(context, "_settle: %s");

        if (context.pendingOrder.ready(context.currentOracleVersion)) _processOrder(context, context.pendingOrder);
        if (context.accountPendingOrder.ready(context.currentOracleVersion)) _processOrderAccount(context, context.accountPendingOrder);

        _endGas(context);
    }

    function _processOrder(CurrentContext memory context, Order memory newOrder) private {
        UFixed6 fundingFee = context.version.accumulate(
            context.order,
            _oracleVersionAt(context.marketParameter, context.order.version),
            _oracleVersionAt(context.marketParameter, newOrder.version),
            context.protocolParameter,
            context.marketParameter
        );
        context.fee.update(fundingFee, context.protocolParameter);
        context.order.update(newOrder);

        _versions[context.pendingOrder.version].store(context.version);
    }

    function _processOrderAccount(CurrentContext memory context, Order memory newOrder) private view {
        context.account.accumulate(
            context.accountOrder,
            _versions[context.accountOrder.version].read(),
            _versions[newOrder.version].read()
        );
        context.accountOrder.update(newOrder);
    }

    // TODO: this needs to be cleaned up somehow
    function _checkOperator(
        CurrentContext memory context,
        address account,
        UFixed6 newMaker,
        UFixed6 newLong,
        UFixed6 newShort,
        Fixed6 newCollateral
    ) private view {
        if (account == msg.sender) return;                  // sender is operating on own account
        if (factory.operators(account, msg.sender)) return; // sender is operator enabled for this account
        if (
            context.accountPendingOrder.maker.eq(newMaker) &&
            context.accountPendingOrder.long.eq(newLong) &&
            context.accountPendingOrder.short.eq(newShort) &&
            context.account.collateral.sign() == -1 && newCollateral.isZero()
        ) return; // sender is repaying shortfall for this account
        revert MarketOperatorNotAllowed();
    }

    function _checkPosition(CurrentContext memory context) private pure {
        if (
            !context.marketParameter.closed &&
            context.pendingOrder.socialized() &&
            context.accountPendingOrder.sub(context.accountOrder).decreasesLiquidity()
        ) revert MarketInsufficientLiquidityError();
        if (context.pendingOrder.maker.gt(context.marketParameter.makerLimit)) revert MarketMakerOverLimitError();
        if (!context.accountPendingOrder.singleSided()) revert MarketNotSingleSidedError();
    }

    function _checkCollateral(CurrentContext memory context) private pure {
        if (context.account.collateral.sign() == -1) revert MarketInDebtError();

        UFixed6 boundedCollateral = UFixed6Lib.from(context.account.collateral);

        if (!context.account.collateral.isZero() && boundedCollateral.lt(context.protocolParameter.minCollateral))
            revert MarketCollateralUnderLimitError();

        UFixed6 maintenanceAmount =
            context.accountOrder.maintenance(context.currentOracleVersion, context.marketParameter)
                .max(context.accountPendingOrder.maintenance(context.currentOracleVersion, context.marketParameter));
        if (maintenanceAmount.gt(boundedCollateral)) revert MarketInsufficientCollateralError();
    }

    function _sync(MarketParameter memory marketParameter) private returns (OracleVersion memory oracleVersion) {
        oracleVersion = marketParameter.oracle.sync();
        marketParameter.payoff.transform(oracleVersion);
    }

    function _oracleVersionAt(
        MarketParameter memory marketParameter,
        uint256 version
    ) internal view returns (OracleVersion memory oracleVersion) {
        oracleVersion = marketParameter.oracle.atVersion(version);
        marketParameter.payoff.transform(oracleVersion);
    }

    // Debug
    function _startGas(CurrentContext memory context, string memory message) private view {
        context.gasCounterMessage = message;
        context.gasCounter = gasleft();
    }

    function _endGas(CurrentContext memory context) private view {
        uint256 endGas = gasleft();
        if (GAS_PROFILE) console.log(context.gasCounterMessage,  context.gasCounter - endGas);
    }
}
