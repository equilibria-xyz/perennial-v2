// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "@equilibria/root/control/unstructured/UInitializable.sol";
import "@equilibria/root/control/unstructured/UOwnable.sol";
import "./interfaces/IMarket.sol";
import "./interfaces/IFactory.sol";
import "hardhat/console.sol";

// TODO: should we move position fees to account position settle so that there's intra-version netting?
// TODO: combine update and settle to enable on-behalf managers
// TODO: general parameter validity checks
// TODO: auto-shutoff rewards if not enough reward ERC20s in contract during accumulate?

/**
 * @title Market
 * @notice Manages logic and state for a single market market.
 * @dev Cloned by the Factory contract to launch new market markets.
 */
contract Market is IMarket, UInitializable, UOwnable {
    struct CurrentContext {
        /* Global Parameters */
        ProtocolParameter protocolParameter;

        /* Market Parameters */
        MarketParameter marketParameter;

        /* Current Global State */
        OracleVersion currentOracleVersion;

        Version version;

        Position position;

        Fee fee;

        /* Current Account State */
        Account account;

        /* Debugging */
        uint256 gasCounter;

        string gasCounterMessage;
    }

    /// @dev The name of the market
    string public name;

    /// @dev The symbol of the market
    string public symbol;

    /// @dev The protocol factory
    IFactory public factory;

    /// @dev ERC20 stablecoin for collateral
    Token18 public token;

    /// @dev ERC20 stablecoin for reward
    Token18 public reward;

    /// @dev Treasury of the market, collects fees
    address public treasury;

    /// @dev Protocol and market fees collected, but not yet claimed
    FeeStorage private _fee;

    PositionStorage private _position;

    /// @dev Mapping of the historical version data
    mapping(uint256 => VersionStorage) _versions;

    /// @dev The individual state for each account
    mapping(address => AccountStorage) private _accounts;

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
        _settle(context);
        _liquidate(context, account);
        _saveContext(context, account);
    }

    function update(UFixed6 newMaker, UFixed6 newTaker, Fixed6 newCollateral) external {
        CurrentContext memory context = _loadContext(msg.sender);
        _settle(context);
        _update(context, msg.sender, msg.sender, newMaker, newTaker, newCollateral, false);
        _saveContext(context, msg.sender);
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

    function accounts(address account) external view returns (Account memory) {
        return _accounts[account].read();
    }

    function versions(uint256 oracleVersion) external view returns (Version memory) {
        return _versions[oracleVersion].read();
    }

    function position() external view returns (Position memory) {
        return _position.read();
    }

    function fee() external view returns (Fee memory) {
        return _fee.read();
    }

    function parameter() external view returns (MarketParameter memory) {
        return _parameter.read();
    }

    function _liquidate(CurrentContext memory context, address account) private {
        // before
        UFixed6 maintenance = context.account.maintenance(context.currentOracleVersion, context.marketParameter.maintenance);
        if (context.account.collateral.gte(Fixed6Lib.from(maintenance)) || context.account.liquidation) return; // cant liquidate
        if (context.marketParameter.closed) return; // cant liquidate

        // compute reward
        Fixed6 liquidationReward = Fixed6Lib.from(
            UFixed6Lib.max(maintenance, context.protocolParameter.minCollateral)
                .mul(context.protocolParameter.liquidationFee)
        ).min(Fixed6.wrap(int256(UFixed18.unwrap(token.balanceOf())) / 1e12));
        Fixed6 newCollateral = context.account.collateral.sub(liquidationReward);

        // close position
        _update(context, account, msg.sender, UFixed6Lib.ZERO, UFixed6Lib.ZERO, newCollateral, true);
        context.account.liquidation = true;

        emit Liquidation(account, msg.sender, liquidationReward);
    }

    function _update(
        CurrentContext memory context,
        address account,
        address receiver,
        UFixed6 newMaker,
        UFixed6 newTaker,
        Fixed6 newCollateral,
        bool force
    ) private {
        _startGas(context, "_update before-update-after: %s");

        // before
        if (context.account.liquidation) revert MarketInLiquidationError();
        if (context.marketParameter.closed && !newMaker.add(newTaker).isZero()) revert MarketClosedError();

        // update
        if (newCollateral.eq(Fixed6Lib.MAX)) newCollateral = context.account.collateral;
        (Fixed6 makerAmount, Fixed6 takerAmount, UFixed6 takerFee, Fixed6 collateralAmount) = context.account.update(
            newMaker,
            newTaker,
            newCollateral,
            context.currentOracleVersion,
            context.marketParameter
        );
        context.position.update(makerAmount, takerAmount);
        UFixed6 takerMarketFee = context.version.update(context.position, takerFee, context.marketParameter);
        context.fee.update(takerMarketFee, context.protocolParameter);

        // after
        if (!force) _checkPosition(context);
        if (!force) _checkCollateral(context);

        _endGas(context);

        _startGas(context, "_update fund-events: %s");

        // fund
        if (collateralAmount.sign() == 1) token.pull(account, UFixed18.wrap(UFixed6.unwrap(collateralAmount.abs()) * 1e12));
        if (collateralAmount.sign() == -1) token.push(receiver, UFixed18.wrap(UFixed6.unwrap(collateralAmount.abs()) * 1e12));

        // events
        emit Updated(account, context.currentOracleVersion.version, newMaker, newTaker, newCollateral);

        _endGas(context);
    }

    function _loadContext(address account) private returns (CurrentContext memory context) {
        _startGas(context, "_loadContext: %s");

        // parameters
        context.protocolParameter = factory.parameter();
        context.marketParameter = _parameter.read();

        // state
        context.currentOracleVersion = _sync(context.marketParameter);
        context.position = _position.read();
        context.fee = _fee.read();
        context.version = _versions[context.position.latestVersion + 1].read();
        context.account = _accounts[account].read();

        // after

        _endGas(context);
    }

    function _saveContext(CurrentContext memory context, address account) private {
        _startGas(context, "_saveContext: %s");

        // state
        _position.store(context.position);
        _fee.store(context.fee);
        _versions[context.position.latestVersion + 1].store(context.version);
        _accounts[account].store(context.account);

        _endGas(context);
    }

    function _settle(CurrentContext memory context) private {
        _startGas(context, "_settle: %s");

        // before
        if (context.protocolParameter.paused) revert MarketPausedError();

        // Initialize memory
        OracleVersion memory fromOracleVersion;
        OracleVersion memory toOracleVersion;
        Version memory fromVersion;
        Version memory toVersion;

        // settle market a->b if necessary
        fromOracleVersion = context.position.latestVersion == context.currentOracleVersion.version ?
            context.currentOracleVersion :
            _oracleVersionAt(context.marketParameter, context.position.latestVersion);
        toOracleVersion = context.position.latestVersion + 1 == context.currentOracleVersion.version ?
            context.currentOracleVersion :
            _oracleVersionAt(context.marketParameter, context.position.latestVersion + 1);
        _settlePeriod(context, fromOracleVersion, toOracleVersion);

        // settle market b->c if necessary
        fromOracleVersion = toOracleVersion;
        toOracleVersion = context.currentOracleVersion;
        _settlePeriod(context, fromOracleVersion, toOracleVersion);

        // settle account a->b if necessary
        toOracleVersion = context.account.latestVersion + 1 == context.currentOracleVersion.version ?
            context.currentOracleVersion :
            _oracleVersionAt(context.marketParameter, context.account.latestVersion + 1);
        fromVersion = _versions[context.account.latestVersion].read();
        toVersion = _versions[context.account.latestVersion + 1].read();
        _settlePeriodAccount(context, toOracleVersion, fromVersion, toVersion);

        // settle account b->c if necessary
        toOracleVersion = context.currentOracleVersion;
        fromVersion = toVersion;
        toVersion = context.version;
        _settlePeriodAccount(context, toOracleVersion, fromVersion, toVersion);

        _endGas(context);
    }

    function _settlePeriod(
        CurrentContext memory context,
        OracleVersion memory fromOracleVersion,
        OracleVersion memory toOracleVersion
    ) private {
        if (context.currentOracleVersion.version > context.position.latestVersion) {
            UFixed6 fundingFee = context.version.accumulate(
                context.position,
                fromOracleVersion,
                toOracleVersion,
                context.protocolParameter,
                context.marketParameter
            );
            context.fee.update(fundingFee, context.protocolParameter);
            context.position.settle(toOracleVersion);
            _versions[toOracleVersion.version].store(context.version);
        }
    }

    function _settlePeriodAccount(
        CurrentContext memory context,
        OracleVersion memory toOracleVersion,
        Version memory fromVersion,
        Version memory toVersion
    ) private pure {
        if (context.currentOracleVersion.version > context.account.latestVersion) {
            context.account.accumulate(toOracleVersion, fromVersion, toVersion);
        }
    }

    function _checkPosition(CurrentContext memory context) private pure {
        if (
            !context.marketParameter.closed &&
            context.position.socializationFactorNext().lt(UFixed6Lib.ONE) &&
            (
                context.account.nextTaker.gt(context.account.taker) ||
                context.account.nextMaker.lt(context.account.maker)
            )
        ) revert MarketInsufficientLiquidityError();

        if (context.position.makerNext.gt(context.marketParameter.makerLimit))
            revert MarketMakerOverLimitError();
    }

    function _checkCollateral(CurrentContext memory context) private pure {
        if (context.account.collateral.sign() == -1) revert MarketInDebtError();

        UFixed6 boundedCollateral = UFixed6Lib.from(context.account.collateral);

        if (!context.account.collateral.isZero() && boundedCollateral.lt(context.protocolParameter.minCollateral))
            revert MarketCollateralUnderLimitError();

        (UFixed6 maintenanceAmount, UFixed6 maintenanceNextAmount) = (
            context.account.maintenance(context.currentOracleVersion, context.marketParameter.maintenance),
            context.account.maintenanceNext(context.currentOracleVersion, context.marketParameter.maintenance)
        );
        if (maintenanceAmount.max(maintenanceNextAmount).gt(boundedCollateral))
            revert MarketInsufficientCollateralError();
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
        console.log(context.gasCounterMessage,  context.gasCounter - endGas);
    }
}
