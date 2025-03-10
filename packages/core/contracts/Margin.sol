// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import { Instance } from "@equilibria/root/attribute/Instance.sol";
import { ReentrancyGuard } from "@equilibria/root/attribute/ReentrancyGuard.sol";
import { Fixed6, Fixed6Lib } from "@equilibria/root/number/types/Fixed6.sol";
import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { Token18, UFixed18, UFixed18Lib } from "@equilibria/root/token/types/Token18.sol";

import { CheckpointLib } from "./libs/CheckpointLib.sol";
import { Checkpoint, CheckpointStorage } from "./types/Checkpoint.sol";
import { Guarantee } from "./types/Guarantee.sol";
import { Local } from "./types/Local.sol";
import { Position } from "./types/Position.sol";
import { RiskParameter } from "./types/RiskParameter.sol";
import { IMargin, OracleVersion } from "./interfaces/IMargin.sol";
import { IMarket, IMarketFactory } from "./interfaces/IMarketFactory.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "hardhat/console.sol";


contract Margin is IMargin, Instance, ReentrancyGuard {
    IMarket private constant CROSS_MARGIN = IMarket(address(0));

    /// @inheritdoc IMargin
    uint256 public constant MAX_CROSS_MARGIN_MARKETS = 8;

    /// @inheritdoc IMargin
    Token18 public immutable DSU; // solhint-disable-line var-name-mixedcase

    /// @dev Contract used to validate markets
    IMarketFactory public marketFactory;

    /// @dev Iterable collection of cross-margined markets for a user (account => markets)
    mapping(address => EnumerableSet.AddressSet) private markets;

    /// @notice Storage for claimable balances: user -> market -> balance
    mapping(address => UFixed6) public claimables;

    /// @notice Storage for account balances: user -> market -> balance
    /// Cross-margin balances stored under IMarket(address(0))
    mapping(address => mapping(IMarket => UFixed6)) private _balances;

    /// @dev Storage for account checkpoints: user -> market -> version -> checkpoint
    /// Cross-margin checkpoints stored as IMarket(address(0))
    mapping(address => mapping(IMarket => mapping(uint256 => CheckpointStorage))) private _checkpoints;

    /// @notice
    mapping(address => mapping(IMarket => uint256)) private _latestCheckpoints;

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

        // TODO: get current version and create cross checkpoint
        _requestCheckpoint(account, Fixed6Lib.from(amount));

        emit FundsDeposited(account, amount);
    }

    // TODO: support a magic number for full withdrawal?
    /// @inheritdoc IMargin
    function withdraw(address account, UFixed6 amount) external nonReentrant onlyOperator(account) {
        Fixed6 balance = _balances[account][CROSS_MARGIN];
        if (balance.lt(Fixed6Lib.from(amount))) revert MarginInsufficientCrossedBalanceError();
        _balances[account][CROSS_MARGIN] = balance.sub(Fixed6Lib.from(amount));

        // TODO: get current version and create cross checkpoint
        _requestCheckpoint(account, Fixed6Lib.from(-1, amount));

        // ensure crossed markets remain margined after withdrawal
        // TODO: check stale, settle?
        if (!_checkCrossMargin(account)) revert IMarket.MarketInsufficientMarginError();

        // withdrawal goes to sender, not account, consistent with legacy Market behavior
        DSU.push(msg.sender, UFixed18Lib.from(amount));
        emit FundsWithdrawn(account, amount);
    }

    /// @inheritdoc IMargin
    function isolate(
        address account,
        IMarket market,
        Fixed6 amount
    ) external nonReentrant onlyOperator(account) {
        _isolate(account, market, amount, true);
    }

    /// @inheritdoc IMargin
    function claim(address account, address receiver) external nonReentrant onlyOperator(account) returns (UFixed6 feeReceived) {
        feeReceived = claimables[account];
        claimables[account] = UFixed6Lib.ZERO;
        DSU.push(receiver, UFixed18Lib.from(feeReceived));
        emit ClaimableWithdrawn(account, receiver, feeReceived);
    }

    /// @inheritdoc IMargin
    function maintained(address account) external onlyMarket view returns (bool isMaintained) {
        IMarket market = IMarket(msg.sender);
        return _isIsolated(account, market) ? _checkIsolatedMaintenance(account, market) : _checkCrossMaintained(account);
    }

    /// @inheritdoc IMargin
    function margined(address account) external onlyMarket view returns (bool isMargined) {
        // TODO: check stale

        IMarket market = IMarket(msg.sender);

         // Settle all cross-margined markets and write a checkpoint
        if (_isCrossed(account, market)) {
            for (uint256 i; i < markets[account].length(); i++) {
                IMarket marketToSettle = markets[account].at(i);
                if (market != marketToSettle) marketToSettle.settle(account);
            }
        }

        return _isIsolated(account, market) ? _checkIsolatedMargin(account, market) : _checkCrossMargin(account);
    }

    /// @inheritdoc IMargin
    function postSettlement(address account, uint256 latestVersion) external onlyMarket {
        // process positions closes on settlement
        IMarket market = IMarket(msg.sender);
        if (market.hasPosition(account)) return; // TODO: replace with worthCasePosition == 0

        // If position is closed, deisolate all funds from the market
        _isolate(account, market, Fixed6Lib.from(-1, _balances[account][market]), true);

        // degegister market from cross margin
        if (_isCrossed(account, market)) _uncross(account, market);
    }

    /// @inheritdoc IMargin
    function updateClaimable(address account, UFixed6 collateralDelta) external onlyMarket {
        claimables[account] = claimables[account].add(collateralDelta);
        emit ClaimableChanged(account, collateralDelta);
    }

    // TODO: Inefficient to keep reading and writing storage for each market when handling a cross-margin settlement,
    // but would be quite dirty to pass a context struct through each Market.
    /// @inheritdoc IMargin
    function postProcessLocal(
        address account,
        uint256 version,
        Fixed6 collateral,
        Fixed6 transfer,
        UFixed6 tradeFee,
        UFixed6 settlementFee
    ) external onlyMarket {
        IMarket market = IMarket(msg.sender);
        if (_isCrossed(account, market)) {
            uint256 latestVersion = _latestCheckpoints[account][CROSS_MARGIN];
            Checkpoint memory latestCheckpoint = _checkpoints[account][CROSS_MARGIN][latestVersion].read();

            if (latestVersion != version) {
                Checkpoint memory next;
                next.collateral = latestCheckpoint.collateral
                    .sub(latestCheckpoint.tradeFee)                       // trade fee processed post settlement
                    .sub(Fixed6Lib.from(latestCheckpoint.settlementFee))  // settlement / liquidation fee processed post settlement
                    .add(latestCheckpoint.transfer);                       // deposit / withdrawal processed post settlement
                latestCheckpoint = next;
            }

            latestCheckpoint.collateral = latestCheckpoint.collateral.add(collateral);        // incorporate collateral change at this settlement
            latestCheckpoint.transfer = latestCheckpoint.transfer.add(transfer);
            latestCheckpoint.tradeFee = latestCheckpoint.tradeFee.add(Fixed6Lib.from(tradeFee));
            latestCheckpoint.settlementFee = latestCheckpoint.settlementFee.add(settlementFee);

            _checkpoints[account][CROSS_MARGIN][version].store(latestCheckpoint);
            _latestCheckpoints[account][CROSS_MARGIN] = version;

            // Update balance
            Fixed6 crossBalance = _balances[account][CROSS_MARGIN];
            _balances[account][CROSS_MARGIN] = crossBalance.add(collateral);
            emit FundsChanged(account, collateral);
        } else {
            // console.log("  Margin::updateCheckpoint for account %s non-cross market %s", account, msg.sender);
            // Store the checkpoint
            _checkpoints[account][IMarket(msg.sender)][version].store(latestMarketCheckpoint);
            // Update balance
            Fixed6 isolatedBalance = _balances[account][market];
            _balances[account][market] = isolatedBalance.add(collateral);
            emit IsolatedFundsChanged(account, market, collateral);
        }
    }

    /// @inheritdoc IMargin
    function isCrossed(address account, IMarket market) external view returns (bool) {
        return _isCrossed(account, market);
    }

    /// @inheritdoc IMargin
    function isIsolated(address account, IMarket market) external view returns (bool) {
        return _isIsolated(account, market);
    }

    /// @inheritdoc IMargin
    function crossMarginCheckpoints(address account, uint256 version) external view returns (Checkpoint memory) {
        return _checkpoints[account][CROSS_MARGIN][version].read();
    }

    /// @inheritdoc IMargin
    function isolatedCheckpoints(address account, IMarket market, uint256 version) external view returns (Checkpoint memory) {
        return _checkpoints[account][market][version].read();
    }

    // TODO
    function _checkIsolatedMargin(address account, IMarket market) private view returns (bool) {
        return _balances[account][market].gte(market.marginRequired(account));
    }

    // TODO
    function _checkIsolatedMaintenance(address account, IMarket market) private view returns (bool) {
        return _balances[account][market].gte(market.maintenanceRequired(account));
    }

    // TODO
    function _checkCrossMargin(address account) private view returns (bool) {
        UFixed6 totalRequirement;
        for (uint256 i; i < markets[account].length(); i++)
            totalRequirement = totalRequirement.add(markets[account].at(i).marginRequired(account, UFixed6Lib.ZERO));
        return _balances[account][CROSS_MARGIN].gte(totalRequirement);
    }

    // TODO
    function _checkCrossMaintained(address account) private view returns (bool) {
        UFixed6 totalRequirement;
        for (uint256 i; i < markets[account].length(); i++)
            totalRequirement = totalRequirement.add(markets[account].at(i).maintenanceRequired(account));
        return _balances[account][CROSS_MARGIN].gte(totalRequirement);
    }

    function _requestCheckpoint(address account, Fixed6 transfer) private {
        // TODO: crete checkpoint with the correct collateral start point
        for (uint256 i; i < markets[account].length(); i++)
            markets[account].at(i).noOpUpdate(account, i == 0 ? transfer : Fixed6Lib.ZERO);
    }

    /// @dev Upserts a market into cross-margin collections
    function _cross(address account, IMarket market) private {
        if (markets[account].add(address(market))) emit MarketCrossed(account, market);
    }

    /// @dev Removes a market from cross-margin collections
    function _uncross(address account, IMarket market) private {
        if (markets[account].remove(address(market))) emit MarketUncrossed(account, market);
    }

    /// @dev Implementation logic for adjusting isolated collateral, must be settled first
    function _isolate(
        address account,
        IMarket market,
        Fixed6 amount,
        bool updateCheckpoint_
    ) private {
        // can only isolate if market is un-assigned, (isolating) or is isolated (re-isolating / de-isolating)
        if (_isCrossed(account, market)) revert MarginHasPositionError();

        if (amount.isZero()) return;

        // Calculate new balances
        _balances[account][CROSS_MARGIN] = _balances[account][CROSS_MARGIN].sub(amount);
        _balances[account][market] = _balances[account][market].add(amount);

        // TODO: we should move checkpoint completely to Margin
        if (updateCheckpoint_) {
            uint256 latestTimestamp = market.oracle().latest().timestamp;
            Checkpoint memory checkpoint = _checkpoints[account][market][latestTimestamp].read();
            checkpoint.transfer = checkpoint.transfer.add(amount);
            _checkpoints[account][market][latestTimestamp].store(checkpoint);
        }

        // TODO: Reduce storage reads by moving margin checks above storage updates, passing new balances into margin check methods

        // If reducing isolated balance (but not deisolating), ensure sufficient margin still exists for the market
        if ((isolating || decreasingIsolatedBalance) && !_checkIsolatedMargin(account, market, UFixed6Lib.ZERO)) {
            revert IMarket.MarketInsufficientMarginError();
        }
        // Ensure decreased cross-margin balance remains sufficient for crossed markets
        if (newIsolatedBalance.gt(oldIsolatedBalance) && !_checkCrossMargin(account)) {
            revert IMarket.MarketInsufficientMarginError();
        }
        // If decreasing an existing isolated balance with position, ensure price is not stale
        if (hasPosition && decreasingIsolatedBalance && market.stale()) {
            revert IMarket.MarketStalePriceError();
        }

        if (isolating) emit MarketIsolated(account, market);
        emit IsolatedFundsChanged(account, market, amount);
    }

    /// @dev Determines whether user has a position or pending order in a specific market
    function _hasPosition(address account, IMarket market) private view returns (bool) {
        return !market.positions(account).magnitude().isZero() || !market.pendings(account).isEmpty();
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
        if (market.factory() != marketFactory) revert MarginInvalidMarketError();
        _;
    }

    /// @dev Only if caller is the account on which action is performed or authorized to interact with account
    modifier onlyOperator(address account) {
        (bool isOperator, ,) = marketFactory.authorization(account, msg.sender, address(0), address(0));
        if (!isOperator) revert MarginOperatorNotAllowedError();
        _;
    }
}