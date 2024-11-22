// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import { Instance } from "@equilibria/root/attribute/Instance.sol";
import { Fixed6 } from "@equilibria/root/number/types/Fixed6.sol";
import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { Token18, UFixed18, UFixed18Lib } from "@equilibria/root/token/types/Token18.sol";

import { Checkpoint, CheckpointStorage } from "./types/Checkpoint.sol";
import { IMargin } from "./interfaces/IMargin.sol";
import { IMarket } from "./interfaces/IMarket.sol";

contract Margin is IMargin, Instance {
    /// @dev DSU address
    Token18 public immutable DSU; // solhint-disable-line var-name-mixedcase

    // TODO: An alternate implementation would be to record a per-user balance,
    // and subtract the isolated balances for each market.  However that would require
    // an expensive iteration through markets.  Also need to determine whether we will
    // track an "unallocated" balance which is neither cross-margin nor isolated.
    /// @notice Collateral spread across markets: user -> balance
    mapping(address => UFixed6) public crossMarginBalances;

    // TODO: mapping for cross-margin checkpoints

    /// @notice Non-cross-margained collateral: user -> market -> balance
    mapping(address => mapping(IMarket => UFixed6)) public isolatedBalances;

    /// @dev Storage for isolated account checkpoints: user -> market -> version -> checkpoint
    mapping(address => mapping(IMarket => mapping(uint256 => CheckpointStorage))) private _isolatedCheckpoints;

    /// @dev Creates instance
    /// @param dsu Digital Standard Unit stablecoin used as collateral
    constructor(Token18 dsu) {
        DSU = dsu;
    }

    /// @inheritdoc IMargin
    function deposit(UFixed6 amount) external {
        DSU.pull(msg.sender, UFixed18Lib.from(amount));
        crossMarginBalances[msg.sender] = crossMarginBalances[msg.sender].add(amount);
    }

    // TODO: support a magic number for full withdrawal?
    /// @inheritdoc IMargin
    function withdraw(UFixed6 amount) external {
        UFixed6 balance = crossMarginBalances[msg.sender];
        if (balance.lt(amount)) revert InsufficientCrossMarginBalance();
        crossMarginBalances[msg.sender] = balance.sub(amount);
        DSU.push(msg.sender, UFixed18Lib.from(amount));
    }

    /// @inheritdoc IMargin
    function isolate(UFixed6 amount, IMarket market) external {
        UFixed6 balance = crossMarginBalances[msg.sender];
        if (balance.lt(amount)) revert InsufficientCrossMarginBalance();
        crossMarginBalances[msg.sender] = balance.sub(amount);
        isolatedBalances[msg.sender][market] = isolatedBalances[msg.sender][market].add(amount);
        // TODO: update collections which track which markets are isolated/crossed
        // TODO: emit an event
    }

    /// @inheritdoc IMargin
    function cross(IMarket market) external {
        UFixed6 balance = isolatedBalances[msg.sender][market];
        if (balance.eq(UFixed6Lib.ZERO)) revert InsufficientIsolatedBalance();
        isolatedBalances[msg.sender][market] = UFixed6Lib.ZERO;
        crossMarginBalances[msg.sender] = crossMarginBalances[msg.sender].add(balance);
        // TODO: update collections which track which markets are isolated/crossed
        // TODO: emit an event
    }

    /// @inheritdoc IMargin
    function margined(address account) external returns (bool isMargined) {
        isMargined = false;
    }

    /// @inheritdoc IMargin
    function maintained(address account) external returns (bool isMaintained) {
        isMaintained = false;
    }

    /// @inheritdoc IMargin
    function update(address account, uint256 version, Checkpoint memory latest) external onlyMarket{
        // TODO: Determine if user is in cross-margin or isolated mode and handle update accordingly.
        _isolatedCheckpoints[account][IMarket(msg.sender)][version].store(latest);
        // TODO: Should probably emit an event here
    }

    /// @inheritdoc IMargin
    function isolatedCheckpoints(address account, IMarket market, uint256 version) external view returns (Checkpoint memory) {
        return _isolatedCheckpoints[account][market][version].read();
    }

    /// @dev Only if the caller is a market
    modifier onlyMarket {
        // TODO: configure MarketFactory and use it to verify msg.sender is a legitimate market?
        _;
    }
}