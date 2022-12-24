// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "@equilibria/root/control/unstructured/UInitializable.sol";
import "@equilibria/root/control/unstructured/UOwnable.sol";
import "@equilibria/root/control/unstructured/UReentrancyGuard.sol";
import "./interfaces/IMarket.sol";
import "./interfaces/IFactory.sol";
import "hardhat/console.sol";


// TODO: position needs less settle on the second period for both global and account

/**
 * @title Market
 * @notice Manages logic and state for a single market market.
 * @dev Cloned by the Factory contract to launch new market markets.
 */
contract Market is IMarket, UInitializable, UOwnable, UReentrancyGuard {
    struct CurrentContext {
        /* Global Parameters */
        ProtocolParameter protocolParameter;

        /* Market Parameters */

        MarketParameter marketParameter;

        /* Current Global State */
        uint256 latestVersion;

        OracleVersion currentOracleVersion;

        Version version;

        Position position;

        Fee fee;

        /* Current Account State */
        uint256 latestAccountVersion;

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
    Fee private _fee;

    Position private _position;

    /// @dev Mapping of the historical version data
    mapping(uint256 => Version) _versions;

    uint256 public latestVersion;

    /// @dev The individual state for each account
    mapping(address => StoredAccountStorage) private _accounts;

    mapping(address => uint256) public latestVersions;

    MarketParameterStorage private constant _parameter = MarketParameterStorage.wrap(keccak256("equilibria.perennial.Market.parameter"));
    function parameter() public view returns (MarketParameter memory) { return _parameter.read(); }

    /**
     * @notice Initializes the contract state
     */
    function initialize(
        IMarket.MarketDefinition calldata definition_,
        MarketParameter calldata parameter_
    ) external initializer(1) {
        __UOwnable__initialize();
        __UReentrancyGuard__initialize();

        factory = IFactory(msg.sender);
        name = definition_.name;
        symbol = definition_.symbol;
        token = definition_.token;
        reward = definition_.reward;
        updateParameter(parameter_);
    }

    //TODO: address 0?
    function settle(address account) external nonReentrant {
        CurrentContext memory context = _loadContext(account);
        _settle(context);
        _saveContext(context, account);
    }

    //TODO support depositTo and withdrawTo
    function update(Fixed18 newPosition, Fixed18 newCollateral) external {
        CurrentContext memory context = _loadContext(msg.sender);
        _settle(context);
        _update(context, msg.sender, newPosition, newCollateral, false);
        _saveContext(context, msg.sender);
    }

    function liquidate(address account)
    external
    nonReentrant
    {
        CurrentContext memory context = _loadContext(account);
        _settle(context);
        _liquidate(context, account);
        _saveContext(context, account);
    }

    function updateTreasury(address newTreasury) external onlyOwner {
        treasury = newTreasury;
        emit TreasuryUpdated(newTreasury);
    }

    function updateParameter(MarketParameter memory newParameter) public onlyOwner {
        //TODO: disallow non-editable params
        _parameter.store(newParameter);
        emit ParameterUpdated(newParameter);
    }

    function claimFee() external {
        Fee memory newFee = _fee;

        if (msg.sender == treasury) {
            UFixed18 feeAmount = newFee.market();
            newFee._market = 0;
            token.push(msg.sender, feeAmount);
            emit FeeClaimed(msg.sender, feeAmount);
        }

        if (msg.sender == factory.treasury()) {
            UFixed18 feeAmount = newFee.protocol();
            newFee._protocol = 0;
            token.push(msg.sender, feeAmount);
            emit FeeClaimed(msg.sender, feeAmount);
        }

        _fee = newFee;
    }

    //TODO: claim reward

    function accounts(address account) external view returns (Account memory) {
        return _accounts[account].read();
    }

    function versions(uint256 oracleVersion) external view returns (Version memory) {
        return _versions[oracleVersion];
    }

    function position() external view returns (Position memory) {
        return _position;
    }

    function fee() external view returns (Fee memory) {
        return _fee;
    }

    function _liquidate(CurrentContext memory context, address account) private {
        // before
        UFixed18 maintenance = context.account.maintenance(context.currentOracleVersion, context.marketParameter.maintenance);
        if (context.account.collateral.gte(Fixed18Lib.from(maintenance))) revert MarketCantLiquidate();

        // close all positions
        _update(context, account, context.account.position.mul(Fixed18Lib.NEG_ONE), Fixed18Lib.ZERO, true);

        // handle liquidation fee
        UFixed18 liquidationFee = factory.liquidationFee(); // TODO: external call
        UFixed18 liquidationReward = UFixed18Lib.min(
            context.account.collateral.max(Fixed18Lib.ZERO).abs(),
            maintenance.mul(liquidationFee)
        );
        context.account.update(
            Fixed18Lib.ZERO, //TODO: all the position stuff is not needed here so might be a gas efficiency check here
            Fixed18Lib.from(-1, liquidationReward),
            context.currentOracleVersion,
            context.marketParameter
        );
        context.account.liquidation = true;

        // remit liquidation reward
        token.push(msg.sender, liquidationReward);

        emit Liquidation(account, msg.sender, liquidationReward);
    }

    function _update(
        CurrentContext memory context,
        address account, //TODO: use for onbehalf of?
        Fixed18 newPosition,
        Fixed18 newCollateral,
        bool force
    ) private {
        _startGas(context, "_update before-update-after: %s");

        // before
        if (context.account.liquidation) revert MarketInLiquidationError();
        if (context.marketParameter.closed && !newPosition.isZero()) revert MarketClosedError();

        // update
        (
            Fixed18 makerAmount,
            Fixed18 takerAmount,
            UFixed18 makerFee,
            UFixed18 takerFee,
            Fixed18 collateralAmount
        ) = context.account.update(
            newPosition,
            newCollateral,
            context.currentOracleVersion,
            context.marketParameter
        );
        context.position.update(makerAmount, takerAmount);
        UFixed18 positionFee = context.version.update(
            context.position,
            makerFee,
            takerFee,
            context.protocolParameter,
            context.marketParameter
        );
        context.fee.update(positionFee, context.protocolParameter);

        // after
        if (!force) _checkPosition(context);
        if (!force) _checkCollateral(context);

        _endGas(context);

        _startGas(context, "_update fund-events: %s");

        // fund
        if (collateralAmount.sign() == 1) token.pull(account, collateralAmount.abs());
        if (collateralAmount.sign() == -1) token.push(account, collateralAmount.abs());

        // events
        emit Updated(account, context.currentOracleVersion.version, newPosition, newCollateral);

        _endGas(context);
    }

    function _loadContext(address account) private returns (CurrentContext memory context) {
        _startGas(context, "_loadContext: %s");

        // Load protocol parameters
        context.protocolParameter = factory.parameter();

        // Load market parameters
        context.marketParameter = parameter();

        // Load market state
        context.currentOracleVersion = _sync(context.marketParameter);
        context.latestVersion = latestVersion;
        context.version = _versions[context.latestVersion + 1];
        context.position = _position;
        context.fee = _fee;

        // Load account state
        context.latestAccountVersion = latestVersions[account];
        context.account = _accounts[account].read();

        // after
        if (context.protocolParameter.paused) revert MarketPausedError();

        _endGas(context);
    }

    function _saveContext(CurrentContext memory context, address account) private {
        _startGas(context, "_saveContext: %s");

        // Save market state
        latestVersion = context.latestVersion;
        _versions[context.latestVersion + 1] = context.version;
        _position = context.position;
        _fee = context.fee;

        // Load account state
        latestVersions[account] = context.latestAccountVersion;
        _accounts[account].store(context.account);

        _endGas(context);
    }

    function _settle(CurrentContext memory context) private { //TODO: should be pure
        _startGas(context, "_settle: %s");

        // Initialize memory
        OracleVersion memory fromOracleVersion;
        OracleVersion memory toOracleVersion;
        Version memory fromVersion;
        Version memory toVersion;

        // settle market a->b if necessary
        fromOracleVersion = context.latestVersion == context.currentOracleVersion.version ? // TODO: make a lazy loader here
            context.currentOracleVersion :
            _oracleVersionAt(context.marketParameter, context.latestVersion);
        toOracleVersion = context.latestVersion + 1 == context.currentOracleVersion.version ?
            context.currentOracleVersion :
            _oracleVersionAt(context.marketParameter, context.latestVersion + 1);
        _settlePeriod(context, fromOracleVersion, toOracleVersion);

        // settle market b->c if necessary
        fromOracleVersion = toOracleVersion;
        toOracleVersion = context.currentOracleVersion;
        _settlePeriod(context, fromOracleVersion, toOracleVersion);

        // settle account a->b if necessary
        toOracleVersion = context.latestAccountVersion + 1 == context.currentOracleVersion.version ?
            context.currentOracleVersion :
            _oracleVersionAt(context.marketParameter, context.latestAccountVersion + 1);
        fromVersion = _versions[context.latestAccountVersion];
        toVersion = _versions[context.latestAccountVersion + 1];
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
        if (context.currentOracleVersion.version > context.latestVersion) {
            UFixed18 fundingFee = context.version.accumulate(
                context.position,
                fromOracleVersion,
                toOracleVersion,
                context.protocolParameter,
                context.marketParameter
            );
            context.fee.update(fundingFee, context.protocolParameter);
            context.position.settle();
            context.latestVersion = toOracleVersion.version;
            _versions[toOracleVersion.version] = context.version;
        }
    }

    function _settlePeriodAccount(
        CurrentContext memory context,
        OracleVersion memory toOracleVersion,
        Version memory fromVersion,
        Version memory toVersion
    ) private pure {
        if (context.currentOracleVersion.version > context.latestAccountVersion) {
            context.account.accumulate(fromVersion, toVersion);
            context.account.liquidation = false;
            context.latestAccountVersion = toOracleVersion.version;
        }
    }

    function _checkPosition(CurrentContext memory context) private pure {
        if (!context.marketParameter.closed && context.position.socializationFactorNext().lt(UFixed18Lib.ONE))
            revert MarketInsufficientLiquidityError();

        if (context.position.makerNext().gt(context.marketParameter.makerLimit))
            revert MarketMakerOverLimitError();
    }

    function _checkCollateral(CurrentContext memory context) private pure {
        if (context.account.collateral.sign() == -1) revert MarketInDebtError();

        UFixed18 boundedCollateral = UFixed18Lib.from(context.account.collateral);

        if (!context.account.collateral.isZero() && boundedCollateral.lt(context.protocolParameter.minCollateral))
            revert MarketCollateralUnderLimitError();

        (UFixed18 maintenanceAmount, UFixed18 maintenanceNextAmount) = (
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
