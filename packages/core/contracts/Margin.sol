// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import { Instance } from "@equilibria/root/attribute/Instance.sol";
import { ReentrancyGuard } from "@equilibria/root/attribute/ReentrancyGuard.sol";
import { Fixed6, Fixed6Lib } from "@equilibria/root/number/types/Fixed6.sol";
import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { Token18, UFixed18, UFixed18Lib } from "@equilibria/root/token/types/Token18.sol";

import { Checkpoint, CheckpointStorage } from "./types/Checkpoint.sol";
import { Position } from "./types/Position.sol";
import { RiskParameter } from "./types/RiskParameter.sol";
import { IMargin, OracleVersion } from "./interfaces/IMargin.sol";
import { IMarket, IMarketFactory } from "./interfaces/IMarketFactory.sol";
import "hardhat/console.sol";

contract Margin is IMargin, Instance, ReentrancyGuard {
    IMarket private constant CROSS_MARGIN = IMarket(address(0));

    /// @dev DSU address
    Token18 public immutable DSU; // solhint-disable-line var-name-mixedcase

    /// @dev Contract used to validate markets
    IMarketFactory public marketFactory;

    // TODO: Introduce an iterable collection of cross-margained markets for a user.

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

    /*/// @inheritdoc IMargin
    function maintained(address account) external returns (bool isMaintained) {
        // TODO: settle all markets and check maintenance requirements
        revert("Not implemented");
    }

    /// @inheritdoc IMargin
    function margined(address account) external returns (bool isMargined) {
        // TODO: settle all markets and check margin requirements
        revert("Not implemented");
    }*/

    // TODO: rename to "maintained" and "margined"
    /// @inheritdoc IMargin
    function checkMaintained(
        address account
    ) external onlyMarket view returns (bool isMaintained) {
        IMarket market = IMarket(msg.sender);
        if (_isIsolated(account, market)) {
            Fixed6 collateral = _balances[account][market];
            UFixed6 requirement = market.maintenanceRequired(account);
            return UFixed6Lib.unsafeFrom(collateral).gte(requirement);
        } else {
            // TODO: aggregate maintenance requirements for each cross-margined market and check
            UFixed6 requirement = market.maintenanceRequired(account);
            if (requirement.isZero()) return true;
            revert("checkMaintained not implemented for cross-margined accounts");
        }
    }

    /// @inheritdoc IMargin
    function checkMargained(
        address account,
        UFixed6 minCollateralization,
        Fixed6 guaranteePriceAdjustment
    ) external onlyMarket view returns (bool isMargined) {
        return _checkMargined(account, IMarket(msg.sender), minCollateralization, guaranteePriceAdjustment);
    }


    /// @inheritdoc IMargin
    function handleMarketUpdate(address account, Fixed6 collateralDelta) external onlyMarket {
        _isolate(account, IMarket(msg.sender), collateralDelta, false);
    }

    /// @inheritdoc IMargin
    function updateBalance(address account, Fixed6 collateralDelta) external onlyMarket {
        _updateCollateralBalance(account, IMarket(msg.sender), collateralDelta);
        // TODO: Emit an event
    }

    /// @inheritdoc IMargin
    function updateCheckpoint(address account, uint256 version, Checkpoint memory latest, Fixed6 pnl) external onlyMarket{
        // Store the checkpoint
        _checkpoints[account][IMarket(msg.sender)][version].store(latest);
        // Adjust cross-margin or isolated collateral balance accordingly
        _updateCollateralBalance(account, IMarket(msg.sender), pnl);
        // TODO: Should probably emit an event here which indexers could use to track PnL
    }

    /// @inheritdoc IMargin
    function crossMarginBalances(address account) external view returns (Fixed6) {
        return _balances[account][CROSS_MARGIN];
    }

    /// @inheritdoc IMargin
    function isolatedBalances(address account, IMarket market) external view returns (Fixed6) {
        return _balances[account][market];
    }

    // TODO: crossMarginCheckpoints accessor view

    /// @inheritdoc IMargin
    function isolatedCheckpoints(address account, IMarket market, uint256 version) external view returns (Checkpoint memory) {
        return _checkpoints[account][market][version].read();
    }

    /// @dev Shares logic for margin checks initiated internally and from a Market
    function _checkMargined(
        address account,
        IMarket market,
        UFixed6 minCollateralization,
        Fixed6 guaranteePriceAdjustment
    ) private view returns (bool isMargined) {
        if (_isIsolated(account, market)) {
            Fixed6 collateral = _balances[account][market].add(guaranteePriceAdjustment);
            UFixed6 requirement = market.marginRequired(account, minCollateralization);
            // console.log("checkMargained with requirement %s and collateral", UFixed6.unwrap(requirement));
            // console.logInt(Fixed6.unwrap(collateral));
            return UFixed6Lib.unsafeFrom(collateral).gte(requirement);
        } else {
            // TODO: aggregate margin requirements for each cross-margined market and check
            UFixed6 requirement = market.maintenanceRequired(account);
            if (requirement.isZero()) return true;
            revert("checkMargained not implemented for cross-margined accounts");
        }
    }

    /// @dev Implementation logic for adjusting isolated collateral, without settling market
    function _isolate(
        address account,
        IMarket market,
        Fixed6 amount,
        bool updateCheckpoint_
    ) private {
        // calculate new balances
        Fixed6 newCrossBalance = _balances[account][CROSS_MARGIN].sub(amount);
        if (newCrossBalance.lt(Fixed6Lib.ZERO)) revert MarginInsufficientCrossedBalance();
        Fixed6 oldIsolatedBalance = _balances[account][market];
        Fixed6 newIsolatedBalance = oldIsolatedBalance.add(amount);
        if (newIsolatedBalance.lt(Fixed6Lib.ZERO)) revert MarginInsufficientIsolatedBalance();

        // Ensure no position if switching modes
        bool isolating = oldIsolatedBalance.isZero() && !newIsolatedBalance.isZero();
        bool crossing = !oldIsolatedBalance.isZero() && newIsolatedBalance.isZero();
        // TODO: We could add logic here to support switching modes with a position.
        if ((isolating || crossing) && _hasPosition(account, market)) revert MarginHasPosition();

        // update storage
        _balances[account][CROSS_MARGIN] = newCrossBalance;
        _balances[account][market] = newIsolatedBalance;
        if (updateCheckpoint_) {
            uint256 latestTimestamp = market.oracle().latest().timestamp;
            Checkpoint memory checkpoint = _checkpoints[account][market][latestTimestamp].read();
            checkpoint.collateral = checkpoint.collateral.add(amount);
            _checkpoints[account][market][latestTimestamp].store(checkpoint);
        }

        // TODO: not sure how I feel about Margin contract reverting with Market errors here
        if (amount.sign() == -1) {
            if (!_checkMargined(account, market, UFixed6Lib.ZERO, Fixed6Lib.ZERO)) {
                revert IMarket.MarketInsufficientMarginError();
            }
            if (market.hasPosition(account) && market.stale()) {
                revert IMarket.MarketStalePriceError();
            }
        }
        // TODO: if amount.sign() = 1, ensure remaining cross-margin balance is sufficient margin for all markets

        if (isolating) emit MarketIsolated(account, market);
        if (crossing) emit MarketCrossed(account, market);
        emit IsolatedFundsChanged(account, market, amount);
    }

    /// @dev Applies a change in collateral to a user
    function _updateCollateralBalance(address account, IMarket market, Fixed6 collateralDelta) private {
        Fixed6 isolatedBalance = _balances[account][market];
        if (isolatedBalance.isZero()) {
            _balances[account][CROSS_MARGIN] = _balances[account][CROSS_MARGIN].add(collateralDelta);
        } else {
            _balances[account][market] = isolatedBalance.add(collateralDelta);
        }
    }

    /// @dev Determines whether user has a position in a specific market
    function _hasPosition(address account, IMarket market) private view returns (bool) {
        return !market.positions(account).magnitude().isZero();
    }

    // TODO: Need public view which determines if market is isolated for user
    /// @dev Determines whether market is in isolated mode for a specific user
    function _isIsolated(address account, IMarket market) private view returns (bool) {
        // TODO: Complexities using 0 as magic number to determine whether market is isolated for user.
        // Not sure how this should eventually behave when market is neither in the cross-market
        // collection nor has an isolated balance.
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