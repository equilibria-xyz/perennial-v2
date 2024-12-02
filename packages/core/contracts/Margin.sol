// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import { Instance } from "@equilibria/root/attribute/Instance.sol";
import { ReentrancyGuard } from "@equilibria/root/attribute/ReentrancyGuard.sol";
import { Fixed6, Fixed6Lib } from "@equilibria/root/number/types/Fixed6.sol";
import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { Token18, UFixed18, UFixed18Lib } from "@equilibria/root/token/types/Token18.sol";

import { Checkpoint, CheckpointStorage } from "./types/Checkpoint.sol";
import { Position, PositionLib } from "./types/Position.sol";
import { RiskParameter } from "./types/RiskParameter.sol";
import { IMargin, OracleVersion } from "./interfaces/IMargin.sol";
import { IMarket, IMarketFactory } from "./interfaces/IMarketFactory.sol";
import "hardhat/console.sol";

contract Margin is IMargin, Instance, ReentrancyGuard {
    /// @dev DSU address
    Token18 public immutable DSU; // solhint-disable-line var-name-mixedcase

    /// @dev Contract used to validate markets
    IMarketFactory public marketFactory;

    /// @notice Collateral spread across markets: user -> balance
    mapping(address => Fixed6) public crossMarginBalances;

    // TODO: Introduce an iterable collection of cross-margained markets for a user.

    /// @notice Non-cross-margained collateral: user -> market -> balance
    mapping(address => mapping(IMarket => Fixed6)) public isolatedBalances;

    /// @dev Storage for isolated account checkpoints: user -> market -> version -> checkpoint
    mapping(address => mapping(IMarket => mapping(uint256 => CheckpointStorage))) private _isolatedCheckpoints;

    // TODO: mapping for cross-margin checkpoints

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
        crossMarginBalances[account] = crossMarginBalances[account].add(Fixed6Lib.from(amount));
        emit FundsDeposited(account, amount);
    }

    // TODO: support a magic number for full withdrawal?
    // TODO: support operator withdrawal?
    /// @inheritdoc IMargin
    function withdraw(UFixed6 amount) external nonReentrant {
        Fixed6 balance = crossMarginBalances[msg.sender];
        if (balance.lt(Fixed6Lib.from(amount))) revert MarginInsufficientCrossedBalance();
        crossMarginBalances[msg.sender] = balance.sub(Fixed6Lib.from(amount));
        DSU.push(msg.sender, UFixed18Lib.from(amount));
        emit FundsWithdrawn(msg.sender, amount);
    }

    /// @inheritdoc IMargin
    function isolate(UFixed6 amount, IMarket market) external nonReentrant{
        // TODO: need I check oracle timestamps here (per InvariantLib) to ensure price is not stale?
        Fixed6 balance = crossMarginBalances[msg.sender];
        Fixed6 signedAmount = Fixed6Lib.from(amount);
        if (balance.lt(signedAmount)) revert MarginInsufficientCrossedBalance();
        crossMarginBalances[msg.sender] = balance.sub(signedAmount);
        isolatedBalances[msg.sender][market] = isolatedBalances[msg.sender][market].add(signedAmount);
        // TODO: update collections which track which markets are isolated/crossed
        // TODO: ensure remaining cross-margin balance is sufficient to maintain all markets
        emit FundsIsolated(msg.sender, market, amount);
    }

    /// @inheritdoc IMargin
    function cross(IMarket market) external nonReentrant {
        // TODO: ensure market has no position
        Fixed6 balance = isolatedBalances[msg.sender][market];
        if (balance.lte(Fixed6Lib.ZERO)) revert MarginInsufficientIsolatedBalance();
        isolatedBalances[msg.sender][market] = Fixed6Lib.ZERO;
        crossMarginBalances[msg.sender] = crossMarginBalances[msg.sender].add(balance);
        // TODO: update collections which track which markets are isolated/crossed
        emit FundsDeisolated(msg.sender, market, UFixed6Lib.from(balance));
    }

    /// @inheritdoc IMargin
    function maintained(address account) external returns (bool isMaintained) {
        // TODO: settle all markets and check maintenance requirements
        isMaintained = false;
    }

    /// @inheritdoc IMargin
    function margined(address account) external returns (bool isMargined) {
        // TODO: settle all markets and check margin requirements
        isMargined = false;
    }

    /// @inheritdoc IMargin
    function checkMaintained(
        address account,
        UFixed6 positionMagnitude,
        OracleVersion calldata latestVersion
    ) external onlyMarket returns (bool isMaintained) {
        IMarket market = IMarket(msg.sender);
        if (_isIsolated(account, market)) {
            Fixed6 collateral = isolatedBalances[account][market];
            return _isMarketMaintained(account, market, collateral, positionMagnitude, latestVersion);
        } else {
            // TODO: aggregate maintenance requirements for each cross-margined market and check;
            //       when aggregating sender market, use positionMagnitude and latestVersion provided by caller
            revert("Cross-margin not yet implemented");
        }
    }

    /// @inheritdoc IMargin
    function checkMargained(
        address account,
        UFixed6 positionMagnitude,
        OracleVersion calldata latestVersion,
        UFixed6 minCollateralization,
        Fixed6 guaranteePriceAdjustment
    ) external onlyMarket returns (bool isMargined) {
        IMarket market = IMarket(msg.sender);
        if (_isIsolated(account, market)) {
            Fixed6 collateral = isolatedBalances[account][market].add(guaranteePriceAdjustment);
            return _isMarketMargined(account, market, collateral, positionMagnitude, latestVersion, minCollateralization);
        } else {
            // TODO: aggregate margin requirements for each cross-margined market and check;
            //       when aggregating sender market, use positionMagnitude and latestVersion provided by caller
            revert("Cross-margin not yet implemented");
        }
    }



    // TODO: we won't need this if we remove collateral params from Market update methods.
    /// @inheritdoc IMargin
    function handleMarketUpdate(address account, Fixed6 collateralDelta) external onlyMarket {
        // Pass through if no user did not make legacy request to change isolated collateral
        if (collateralDelta.isZero()) return;

        IMarket market = IMarket(msg.sender);
        Fixed6 isolatedBalance = isolatedBalances[account][market];

        // Handle case where market was not already in isolated mode
        if (!_isIsolated(account, market)) {
            // NOTE: this section is currently unreachable because _isIsolated always returns true.

            // Cannot remove isolated collateral if market not isolated
            if (collateralDelta.lt(Fixed6Lib.ZERO)) revert MarginInsufficientIsolatedBalance();

            // Users cannot change their cross-margined balance using legacy update
            Position memory position = market.positions(account);
            if (!position.magnitude().isZero()) revert MarginCannotUpdateCrossedMarket();
        }

        // If market already in in isolated mode, adjust collateral balances
        Fixed6 newCrossBalance = crossMarginBalances[account].sub(collateralDelta);
        // Revert if insufficient funds to isolate
        if (newCrossBalance.lt(Fixed6Lib.ZERO)) revert MarginInsufficientCrossedBalance();

        // Revert if attempting to de-isolate more than is currently isolated
        Fixed6 newIsolatedBalance = isolatedBalance.add(collateralDelta);
        if (newIsolatedBalance.lt(Fixed6Lib.ZERO)) revert MarginInsufficientIsolatedBalance();

        crossMarginBalances[account] = newCrossBalance;
        isolatedBalances[account][market] = newIsolatedBalance;

        // TODO: Ensure InvariantLib checks margin and maintenance requirements and reverts where appropriate.
    }

    /// @inheritdoc IMargin
    function updateBalance(address account, Fixed6 collateralDelta) external onlyMarket {
        _updateCollateralBalance(account, IMarket(msg.sender), collateralDelta);
        // TODO: Emit an event
    }

    /// @inheritdoc IMargin
    function updateCheckpoint(address account, uint256 version, Checkpoint memory latest, Fixed6 pnl) external onlyMarket{
        // Store the checkpoint
        _isolatedCheckpoints[account][IMarket(msg.sender)][version].store(latest);
        // Adjust cross-margin or isolated collateral balance accordingly
        _updateCollateralBalance(account, IMarket(msg.sender), pnl);
        // TODO: Should probably emit an event here which indexers could use to track PnL
    }

    /// @inheritdoc IMargin
    function isolatedCheckpoints(address account, IMarket market, uint256 version) external view returns (Checkpoint memory) {
        return _isolatedCheckpoints[account][market][version].read();
    }

    /// @dev Applies a change in collateral to a user
    function _updateCollateralBalance(address account, IMarket market, Fixed6 collateralDelta) private {
        Fixed6 isolatedBalance = isolatedBalances[account][market];
        if (isolatedBalance.isZero()) {
            crossMarginBalances[account] = crossMarginBalances[account].add(collateralDelta);
        } else {
            isolatedBalances[account][market] = isolatedBalance.add(collateralDelta);
        }
    }

    /// @dev Determines whether market is in isolated mode for a specific user
    function _isIsolated(address account, IMarket market) private view returns (bool) {
        // TODO: We cannot use 0 as magic number to determine whether market is isolated for user.
        // Not sure how this should eventually behave when market is neither in the cross-market
        // collection nor has an isolated balance.
        return true;
    }

    /// @dev Checks whether maintenance requirements are satisfied for specific user and market
    function _isMarketMaintained(
        address account,
        IMarket market,
        Fixed6 collateral,
        UFixed6 positionMagnitude,
        OracleVersion calldata latestVersion
    ) private returns (bool isMaintained) {
        if (collateral.lt(Fixed6Lib.ZERO)) return false; // negative collateral balance forbidden, regardless of position
        if (positionMagnitude.isZero()) return true;     // zero position has no requirement

        UFixed6 requirement = PositionLib.maintenance(
            positionMagnitude,
            latestVersion,
            market.riskParameter()
        );
        isMaintained = UFixed6Lib.unsafeFrom(collateral).gte(requirement);
    }

    /// @dev Checks whether margin requirements are satisfied for specific user and market
    /// @param minCollateralization minimum collateralization specified on an intent, otherwise 0
    function _isMarketMargined(
        address account,
        IMarket market,
        Fixed6 collateral,
        UFixed6 positionMagnitude,
        OracleVersion calldata latestVersion,
        UFixed6 minCollateralization
    ) private returns (bool isMargined) {
        // console.log("_isMarketMargined checking margin for collateral %s, position %s",
        //     UFixed6.unwrap(collateral.abs()), UFixed6.unwrap(positionMagnitude));
        if (collateral.lt(Fixed6Lib.ZERO)) return false; // negative collateral balance forbidden, regardless of position
        if (positionMagnitude.isZero()) return true;     // zero position has no requirement

        UFixed6 requirement = PositionLib.margin(
            positionMagnitude,
            latestVersion,
            market.riskParameter(),
            minCollateralization);
        isMargined = UFixed6Lib.unsafeFrom(collateral).gte(requirement);
    }


    /// @dev Only if caller is a market from the same Perennial deployment
    modifier onlyMarket {
        IMarket market = IMarket(msg.sender);
        if (market.factory() != marketFactory) revert MarginInvalidMarket();
        _;
    }
}