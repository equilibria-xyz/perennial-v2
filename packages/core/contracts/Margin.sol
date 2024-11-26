// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import { Instance } from "@equilibria/root/attribute/Instance.sol";
import { Fixed6, Fixed6Lib } from "@equilibria/root/number/types/Fixed6.sol";
import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { Token18, UFixed18, UFixed18Lib } from "@equilibria/root/token/types/Token18.sol";

import { Checkpoint, CheckpointStorage } from "./types/Checkpoint.sol";
import { Position } from "./types/Position.sol";
import { RiskParameter } from "./types/RiskParameter.sol";
import { IMargin, OracleVersion } from "./interfaces/IMargin.sol";
import { IMarket } from "./interfaces/IMarket.sol";

contract Margin is IMargin, Instance {
    /// @dev DSU address
    Token18 public immutable DSU; // solhint-disable-line var-name-mixedcase

    // TODO: An alternate implementation would be to record a per-user balance,
    // and subtract the isolated balances for each market.  However that would require
    // an expensive iteration through markets.  Also need to determine whether we will
    // track an "unallocated" balance which is neither cross-margin nor isolated.
    /// @notice Collateral spread across markets: user -> balance
    mapping(address => Fixed6) public crossMarginBalances;

    // TODO: How do we know if a market is in isolated mode?  Nonzero balance could just mean they withdrew.
    // We could create another mapping, or turn the isolatedBalances mapping value into a struct with a bool and a balance.
    // Checkpoint/Local stores/stored collateral as an int64, so we have plenty of room in a single storage slot.

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

    /// @inheritdoc IMargin
    function deposit(UFixed6 amount) external {
        DSU.pull(msg.sender, UFixed18Lib.from(amount));
        crossMarginBalances[msg.sender] = crossMarginBalances[msg.sender].add(Fixed6Lib.from(amount));
        // TODO: emit an event
    }

    // TODO: support a magic number for full withdrawal?
    /// @inheritdoc IMargin
    function withdraw(UFixed6 amount) external {
        Fixed6 balance = crossMarginBalances[msg.sender];
        if (balance.lt(Fixed6Lib.from(amount))) revert MarginInsufficientCrossedBalance();
        crossMarginBalances[msg.sender] = balance.sub(Fixed6Lib.from(amount));
        DSU.push(msg.sender, UFixed18Lib.from(amount));
        // TODO: emit an event
    }

    /// @inheritdoc IMargin
    function isolate(UFixed6 amount, IMarket market) external {
        // TODO: need I check oracle timestamps here (per InvariantLib) to ensure price is not stale?
        Fixed6 balance = crossMarginBalances[msg.sender];
        Fixed6 signedAmount = Fixed6Lib.from(amount);
        if (balance.lt(signedAmount)) revert MarginInsufficientCrossedBalance();
        crossMarginBalances[msg.sender] = balance.sub(signedAmount);
        isolatedBalances[msg.sender][market] = isolatedBalances[msg.sender][market].add(signedAmount);
        // TODO: update collections which track which markets are isolated/crossed
        // TODO: emit an event
    }

    /// @inheritdoc IMargin
    function cross(IMarket market) external {
        Fixed6 balance = isolatedBalances[msg.sender][market];
        if (balance.lte(Fixed6Lib.ZERO)) revert MarginInsufficientIsolatedBalance();
        isolatedBalances[msg.sender][market] = Fixed6Lib.ZERO;
        crossMarginBalances[msg.sender] = crossMarginBalances[msg.sender].add(balance);
        // TODO: update collections which track which markets are isolated/crossed
        // TODO: emit an event
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
            isMaintained = false;
        }
    }

    /// @inheritdoc IMargin
    function checkMargained(
        address account,
        UFixed6 positionMagnitude,
        OracleVersion calldata latestVersion
    ) external onlyMarket returns (bool isMargined) {
        IMarket market = IMarket(msg.sender);
        if (_isIsolated(account, market)) {
            Fixed6 collateral = isolatedBalances[account][market];
            return _isMarketMargined(account, market, collateral, positionMagnitude, latestVersion);
        } else {
            // TODO: aggregate margin requirements for each cross-margined market and check;
            //       when aggregating sender market, use positionMagnitude and latestVersion provided by caller
            isMargined = false;
        }
    }



    // TODO: we won't need this if we remove collateral params from Market update methods.
    /// @inheritdoc IMargin
    function handleMarketUpdate(address account, Fixed6 collateralDelta) external onlyMarket {
        // Pass through if no user did not make legacy request to change isolated collateral
        if (collateralDelta.eq(Fixed6Lib.ZERO)) return;

        IMarket market = IMarket(msg.sender);
        Fixed6 isolatedBalance = isolatedBalances[account][market];

        // Handle case where market was not already in isolated mode
        if (!_isIsolated(account, market)) {
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

    // TODO: rename updateCheckpoint
    /// @inheritdoc IMargin
    function update(address account, uint256 version, Checkpoint memory latest, Fixed6 pnl) external onlyMarket{
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
        if (isolatedBalance.eq(Fixed6Lib.ZERO)) {
            crossMarginBalances[account] = crossMarginBalances[account].add(collateralDelta);
        } else {
            isolatedBalances[account][market] = isolatedBalance.add(collateralDelta);
        }
    }

    /// @dev Determines whether market is in isolated mode for a specific user
    function _isIsolated(address account, IMarket market) private view returns (bool) {
        // TODO: Methinks we cannot use 0 as magic number to determine whether market is isolated for user.
        // Fee or PnL accumulation could make it land on 0 isolated collateral with a position,
        // turning it cross-market implictly.
        return !isolatedBalances[account][market].eq(Fixed6Lib.ZERO);
    }

    function _isMarketMaintained(
        address account,
        IMarket market,
        Fixed6 collateral,
        UFixed6 positionMagnitude,
        OracleVersion calldata latestVersion
    ) private returns (bool isMaintained) {
        if (collateral.lt(Fixed6Lib.ZERO)) return false; // negative collateral balance forbidden, regardless of position
        if (positionMagnitude.isZero()) return true;     // zero position has no requirement

        RiskParameter memory riskParameter = market.riskParameter();
        UFixed6 requirement = _collateralRequirement(
            collateral,
            positionMagnitude,
            latestVersion.price.abs(),
            riskParameter.maintenance,
            riskParameter.minMaintenance
        );
        isMaintained = UFixed6Lib.unsafeFrom(collateral).gte(requirement);
    }

    /// @dev Checks whether user's margin requirements are satisfied
    /// @param market Pass market in isolated mode to check single market, or 0 address to check everything for user
    function _isMarketMargined(
        address account,
        IMarket market,
        Fixed6 collateral,
        UFixed6 positionMagnitude,
        OracleVersion calldata latestVersion
    ) private returns (bool isMargined) {
        if (collateral.lt(Fixed6Lib.ZERO)) return false; // negative collateral balance forbidden, regardless of position
        if (positionMagnitude.isZero()) return true;     // zero position has no requirement

        RiskParameter memory riskParameter = market.riskParameter();
        // TODO: need to take riskParameter.margin.max(collateralization) of some collateralization provided by context
        // TODO: need to apply price override adjustment from intent if present
        UFixed6 requirement = _collateralRequirement(
            collateral,
            positionMagnitude,
            latestVersion.price.abs(),
            riskParameter.margin,
            riskParameter.minMargin
        );
        isMargined = UFixed6Lib.unsafeFrom(collateral).gte(requirement);
    }

    function _collateralRequirement(
        Fixed6 collateral,
        UFixed6 positionMagnitude,
        UFixed6 price,
        UFixed6 requirementRatio,
        UFixed6 requirementFixed
    ) private returns (UFixed6 requirement) {
        requirement = positionMagnitude.mul(price).mul(requirementRatio).max(requirementFixed);
    }



    /// @dev Only if the caller is a market
    modifier onlyMarket {
        // TODO: configure MarketFactory and use it to verify msg.sender is a legitimate market?
        // It is super-important that a bad actor cannot create a malicious IMarket
        // which awards fake PnL to an attacker controlled account to steal funds.
        _;
    }
}