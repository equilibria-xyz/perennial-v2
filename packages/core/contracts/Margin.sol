// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import { Instance } from "@equilibria/root/attribute/Instance.sol";
import { ReentrancyGuard } from "@equilibria/root/attribute/ReentrancyGuard.sol";
import { Fixed6, Fixed6Lib } from "@equilibria/root/number/types/Fixed6.sol";
import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { Token18, UFixed18, UFixed18Lib } from "@equilibria/root/token/types/Token18.sol";

import { Checkpoint, CheckpointStorage } from "./types/Checkpoint.sol";
import { Guarantee } from "./types/Guarantee.sol";
import { Local } from "./types/Local.sol";
import { Position } from "./types/Position.sol";
import { RiskParameter } from "./types/RiskParameter.sol";
import { IMargin, OracleVersion } from "./interfaces/IMargin.sol";
import { IMarket, IMarketFactory } from "./interfaces/IMarketFactory.sol";

contract Margin is IMargin, Instance, ReentrancyGuard {
    IMarket private constant CROSS_MARGIN = IMarket(address(0));

    /// @inheritdoc IMargin
    uint256 public constant MAX_CROSS_MARGIN_MARKETS = 8;

    /// inheritdoc IMargin
    Token18 public immutable DSU; // solhint-disable-line var-name-mixedcase

    /// @dev Contract used to validate markets
    IMarketFactory public marketFactory;

    // Iterable collection of cross-margined markets for a user (account => markets)
    mapping(address => IMarket[]) private crossMarginMarkets;

    // Looks up index of the cross-margined market (account => market => index)
    mapping(address => mapping(IMarket => uint256)) private crossMarginMarketIndex;

    // TODO: Once exposure is eliminated, make this unsigned
    /// @notice Storage for claimable balances: user -> market -> balance
    mapping(address => Fixed6) public claimables;

    /// @notice Storage for account balances: user -> market -> balance
    /// Cross-margin balances stored under IMarket(address(0))
    mapping(address => mapping(IMarket => Fixed6)) private _balances;

    /// @dev Storage for account checkpoints: user -> market -> version -> checkpoint
    /// Cross-margin checkpoints stored as IMarket(address(0))
    mapping(address => mapping(IMarket => mapping(uint256 => CheckpointStorage))) private _checkpoints;

    /// @dev Creates instance
    /// @param dsu Digital Standard Unit stablecoin used as collateral
    constructor(Token18 dsu) {
        DSU = dsu;
    }

    /// @notice Initializes the contract state
    /// @param marketFactory_ Identifies the deployment to which this contract belongs
    function initialize(IMarketFactory marketFactory_) external initializer(1) {
        __Instance__initialize();
        __ReentrancyGuard__initialize();
        marketFactory = marketFactory_;
    }

    /// @inheritdoc IMargin
    function deposit(address account, UFixed6 amount) external nonReentrant {
        DSU.pull(msg.sender, UFixed18Lib.from(amount));
        _balances[account][CROSS_MARGIN] = _balances[account][CROSS_MARGIN].add(Fixed6Lib.from(amount));
        emit FundsDeposited(account, amount);
    }

    // TODO: support a magic number for full withdrawal?
    /// @inheritdoc IMargin
    function withdraw(address account, UFixed6 amount) external nonReentrant onlyOperator(account) {
        Fixed6 balance = _balances[account][CROSS_MARGIN];
        if (balance.lt(Fixed6Lib.from(amount))) revert MarginInsufficientCrossedBalance();
        _balances[account][CROSS_MARGIN] = balance.sub(Fixed6Lib.from(amount));

        // ensure crossed markets remain margined after withdrawal
        if (!_crossMargined(account)) revert IMarket.MarketInsufficientMarginError();

        // withdrawal goes to sender, not account, consistent with legacy Market behavior
        DSU.push(msg.sender, UFixed18Lib.from(amount));
        emit FundsWithdrawn(account, amount);
    }

    /// @inheritdoc IMargin
    function isolate(
        address account,
        IMarket market,
        Fixed6 amount
    ) external nonReentrant onlyOperator(account){
        market.settle(account);
        _isolate(account, market, amount, true);
    }

    /// @inheritdoc IMargin
    function claim(address account, address receiver) external nonReentrant onlyOperator(account) returns (UFixed6 feeReceived) {
        feeReceived = UFixed6Lib.from(claimables[account]);
        claimables[account] = Fixed6Lib.ZERO;
        DSU.push(receiver, UFixed18Lib.from(feeReceived));
        emit ClaimableWithdrawn(account, receiver, feeReceived);
    }

    /// @inheritdoc IMargin
    function maintained(
        address account
    ) external onlyMarket view returns (bool isMaintained) {
        IMarket market = IMarket(msg.sender);
        if (_isIsolated(account, market)) {
            Fixed6 collateral = _balances[account][market];
            UFixed6 requirement = market.maintenanceRequired(account);
            return UFixed6Lib.unsafeFrom(collateral).gte(requirement);
        } else {
            return _crossMaintained(account);
        }
    }

    /// @inheritdoc IMargin
    function margined(
        address account,
        UFixed6 minCollateralization,
        Fixed6 guaranteePriceAdjustment
    ) external onlyMarket view returns (bool isMargined) {
        return _margined(account, IMarket(msg.sender), minCollateralization, guaranteePriceAdjustment);
    }


    /// @inheritdoc IMargin
    function handleMarketUpdate(address account, Fixed6 collateralDelta) external onlyMarket {
        if (!collateralDelta.isZero() || _isIsolated(account, IMarket(msg.sender)))
            // Account's isolated collateral is changing, or market is already isolated
            _isolate(account, IMarket(msg.sender), collateralDelta, false);
        else
            // Ensure market is tracked as cross-margined
            _cross(account, IMarket(msg.sender));
    }

    /// @inheritdoc IMargin
    function updateClaimable(address account, Fixed6 collateralDelta) external onlyMarket {
        claimables[account] = claimables[account].add(collateralDelta);
        emit ClaimableChanged(account, collateralDelta);
    }

    /// @inheritdoc IMargin
    function updateCheckpoint(address account, uint256 version, Checkpoint memory latest, Fixed6 pnl) external onlyMarket{
        // Store the checkpoint
        _checkpoints[account][IMarket(msg.sender)][version].store(latest);
        // Adjust cross-margin or isolated collateral balance accordingly
        _updateCollateralBalance(account, IMarket(msg.sender), pnl);
    }

    /// @inheritdoc IMargin
    function crossMarginBalances(address account) external view returns (Fixed6) {
        return _balances[account][CROSS_MARGIN];
    }

    /// @inheritdoc IMargin
    function isolatedBalances(address account, IMarket market) external view returns (Fixed6) {
        return _balances[account][market];
    }

    /// @inheritdoc IMargin
    function isCrossed(address account, IMarket market) external view returns (bool) {
        return _isCrossed(account, market);
    }

    /// @inheritdoc IMargin
    function isIsolated(address account, IMarket market) external view returns (bool) {
        return _isIsolated(account, market);
    }

    // TODO: crossMarginCheckpoints accessor view

    /// @inheritdoc IMargin
    function isolatedCheckpoints(address account, IMarket market, uint256 version) external view returns (Checkpoint memory) {
        return _checkpoints[account][market][version].read();
    }

    /// @dev Shares logic for margin checks initiated internally and from a Market
    function _margined(
        address account,
        IMarket market,
        UFixed6 minCollateralization,
        Fixed6 guaranteePriceAdjustment
    ) private view returns (bool isMargined) {
        Fixed6 collateral = _balances[account][market].add(guaranteePriceAdjustment);
        if (_isIsolated(account, market)) {
            // Market in isolated mode; only need to check against isolated balance
            UFixed6 requirement = market.marginRequired(account, minCollateralization);
            return UFixed6Lib.unsafeFrom(collateral).gte(requirement);
        } else {
            // Market in cross-margin mode; check all cross-margined markets
            return _crossMargined(account);
        }
    }

    // TODO: handle minCollateralization for cross-margined markets
    function _crossMargined(address account) private view returns (bool isMargined) {
        IMarket market;
        UFixed6 requirement;
        Fixed6 guaranteePriceAdjustment;
        for (uint256 i; i < crossMarginMarkets[account].length; i++) {
            market = crossMarginMarkets[account][i];
            requirement = requirement.add(market.marginRequired(account, UFixed6Lib.ZERO));
            guaranteePriceAdjustment = guaranteePriceAdjustment.add(_guaranteePriceAdjustment(market, account));
        }
        return UFixed6Lib.unsafeFrom(_balances[account][CROSS_MARGIN].add(guaranteePriceAdjustment)).gte(requirement);
    }

    /// @dev Aggregates price adjustments from guarantees for a user in a market
    function _guaranteePriceAdjustment(IMarket market, address account) private view returns (Fixed6 guaranteePriceAdjustment) {
        Local memory local = market.locals(account);
        for (uint256 id = local.latestId + 1; id <= local.currentId; id++) {
            Guarantee memory guarantee = market.guarantees(account, id);
            (OracleVersion memory latestOracleVersion, ) = market.oracle().status();
            guaranteePriceAdjustment = guaranteePriceAdjustment.add(guarantee.priceAdjustment(latestOracleVersion.price));
        }
        return guaranteePriceAdjustment;
    }

    function _crossMaintained(address account) private view returns (bool isMaintained) {
        IMarket market;
        UFixed6 requirement;
        for (uint256 i; i < crossMarginMarkets[account].length; i++) {
            market = crossMarginMarkets[account][i];
            requirement = requirement.add(market.maintenanceRequired(account));
        }
        return UFixed6Lib.unsafeFrom(_balances[account][CROSS_MARGIN]).gte(requirement);
    }

    /// @dev Upserts a market into cross-margin collections
    function _cross(address account, IMarket market) private {
        if (!_isCrossed(account, market)) {
            uint256 newIndex = crossMarginMarkets[account].length;
            if (newIndex == MAX_CROSS_MARGIN_MARKETS) revert MarginTooManyCrossedMarkets();
            crossMarginMarkets[account].push(market);
            crossMarginMarketIndex[account][market] = newIndex;
            emit MarketCrossed(account, market);
        }
    }

    /// @dev Removes a market from cross-margin collections
    function _uncross(address account, IMarket market) private {
        if (_isCrossed(account, market)) {
            uint256 index = crossMarginMarketIndex[account][market];
            uint256 lastIndex = crossMarginMarkets[account].length - 1;
            if (index != lastIndex) {
                // Swap last item with the one being removed
                IMarket lastMarket = crossMarginMarkets[account][lastIndex];
                crossMarginMarkets[account][index] = lastMarket;
                crossMarginMarketIndex[account][lastMarket] = index;
            }
            // Remove the last item
            crossMarginMarkets[account].pop();
            delete crossMarginMarketIndex[account][market];
        }
    }

    /// @dev Implementation logic for adjusting isolated collateral, without settling market
    function _isolate(
        address account,
        IMarket market,
        Fixed6 amount,
        bool updateCheckpoint_
    ) private {
        // Calculate new balances
        Fixed6 newCrossBalance = _balances[account][CROSS_MARGIN].sub(amount);
        if (newCrossBalance.lt(Fixed6Lib.ZERO)) revert MarginInsufficientCrossedBalance();
        Fixed6 oldIsolatedBalance = _balances[account][market];
        Fixed6 newIsolatedBalance = oldIsolatedBalance.add(amount);
        if (newIsolatedBalance.lt(Fixed6Lib.ZERO)) revert MarginInsufficientIsolatedBalance();

        // Ensure no position if switching modes
        bool isolating = oldIsolatedBalance.isZero() && !newIsolatedBalance.isZero();
        bool deisolating = !oldIsolatedBalance.isZero() && newIsolatedBalance.isZero();
        // TODO: We could add logic here to support switching modes with a position.
        if ((isolating || deisolating) && _hasPosition(account, market)) revert MarginHasPosition();
        bool decreasingIsolatedBalance = newIsolatedBalance.lt(oldIsolatedBalance);

        // If switching mode to isolated, remove from cross-margin collections
        if (isolating) _uncross(account, market);

        // Update storage
        _balances[account][CROSS_MARGIN] = newCrossBalance;
        _balances[account][market] = newIsolatedBalance;
        if (updateCheckpoint_) {
            uint256 latestTimestamp = market.oracle().latest().timestamp;
            Checkpoint memory checkpoint = _checkpoints[account][market][latestTimestamp].read();
            checkpoint.collateral = checkpoint.collateral.add(amount);
            _checkpoints[account][market][latestTimestamp].store(checkpoint);
        }

        // TODO: Reduce storage reads by moving margin checks above storage updates, passing new balances into margin check methods

        // If reducing isolated balance (but not deisolating), ensure sufficient margin still exists for the market
        if ((isolating || decreasingIsolatedBalance) && !_margined(account, market, UFixed6Lib.ZERO, Fixed6Lib.ZERO)) {
            revert IMarket.MarketInsufficientMarginError();
        }
        // Ensure decreased cross-margin balance remains sufficient for crossed markets
        if (newIsolatedBalance.gt(oldIsolatedBalance) && !_crossMargined(account)) {
            revert IMarket.MarketInsufficientMarginError();
        }

        // If decreasing an existing isolated balance with position, ensure price is not stale
        if (market.hasPosition(account) && decreasingIsolatedBalance && market.stale()) {
            revert IMarket.MarketStalePriceError();
        }

        if (isolating) emit MarketIsolated(account, market);
        emit IsolatedFundsChanged(account, market, amount);
    }

    /// @dev Applies a change in collateral to a user
    function _updateCollateralBalance(address account, IMarket market, Fixed6 collateralDelta) private {
        Fixed6 isolatedBalance = _balances[account][market];
        if (isolatedBalance.isZero()) {
            _balances[account][CROSS_MARGIN] = _balances[account][CROSS_MARGIN].add(collateralDelta);
            emit FundsChanged(account, collateralDelta);
        } else {
            _balances[account][market] = isolatedBalance.add(collateralDelta);
            emit IsolatedFundsChanged(account, market, collateralDelta);
        }
    }

    /// @dev Determines whether user has a position in a specific market
    function _hasPosition(address account, IMarket market) private view returns (bool) {
        return !market.positions(account).magnitude().isZero();
    }

    /// @dev Determines whether a market update occurred for a non-isolated market
    function _isCrossed(address account, IMarket market) private view returns (bool) {
        return crossMarginMarkets[account].length != 0 // at least one market is cross-margined
            // market actually exists at the specified index (since index defaults to 0)
            && crossMarginMarkets[account][crossMarginMarketIndex[account][market]] == market;
    }

    /// @dev Determines whether market is in isolated mode for a specific user
    function _isIsolated(address account, IMarket market) private view returns (bool) {
        // market has an isolated balance
        return !_balances[account][market].isZero();
    }

    /// @dev Only if caller is a market from the same Perennial deployment
    modifier onlyMarket {
        IMarket market = IMarket(msg.sender);
        if (market.factory() != marketFactory) revert MarginInvalidMarket();
        _;
    }

    /// @dev Only if caller is the account on which action is performed or authorized to interact with account
    modifier onlyOperator(address account) {
        (bool isOperator, ,) = marketFactory.authorization(account, msg.sender, address(0), address(0));
        if (!isOperator) revert MarginOperatorNotAllowedError();
        _;
    }
}