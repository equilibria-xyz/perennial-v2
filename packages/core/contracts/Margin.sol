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

    /// @dev The list of orders for an account by index
    mapping(address => uint256[]) private _orders;

    /// @dev The index of the latest order with incoporation finalized for an account
    mapping(address => uint256) private _incorporated;

    /// @dev The index of the latest order with initialization finalized for an account
    mapping(address => uint256) private _initialized;

    /// @dev The most recent order index for an account
    mapping(address => uint256) private _current;

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
    function update(address account, Fixed6 amount) external nonReentrant { // TODO: settle?
        _update(account, amount);
    }

    /// @inheritdoc IMargin
    function claim(address account, address receiver) external nonReentrant onlyOperator(account) returns (UFixed6 feeReceived) {
        feeReceived = claimables[account];
        claimables[account] = UFixed6Lib.ZERO;
        DSU.push(receiver, UFixed18Lib.from(feeReceived));
        emit ClaimableWithdrawn(account, receiver, feeReceived);
    }

    /// @dev Implementation logic for adjusting isolated collateral, must be settled first
    function preUpdate(address account, Fixed6 amount) external onlyMarket {
        IMarket market = IMarket(msg.sender);

        // can only isolate if market is un-assigned, (isolating) or is isolated (re-isolating / de-isolating)
        if (crossed(account, market)) revert MarginHasPositionError();

        _update(account, amount.mul(Fixed6Lib.from(-1)));

        _balances[account][market] = _balances[account][market].add(amount);
        if (amount.lt(UFixed6Lib.ZERO) && !_checkIsolatedMargin(account, market, UFixed6Lib.ZERO))
            revert IMarket.MarketInsufficientMarginError();
    }

    function postUpdate(address account, Fixed6 amount, bool protected) external onlyMarket {
        IMarket market = IMarket(msg.sender);

         // Settle all cross-margined markets and write a checkpoint
        if (crossed(account, market)) {
            for (uint256 i; i < markets[account].length(); i++) {
                IMarket marketToSettle = markets[account].at(i);
                if (market != marketToSettle) marketToSettle.settle(account);
            }
        }

        // TODO: skip invariant if "improving position (close / isolate)"

        // check if price is stale
        if (market.stale()) revert IMarket.MarketStalePriceError();

        // if protected, check that maintenance is violated, otherwise check if update is properly margined
        if (protected) {
            if ((isolated(account, market) ? _checkIsolatedMaintenance(account, market) : _checkCrossMaintained(account)))
                return IMarket.MarketInvalidProtectionError();
        } else {
            if (!(isolated(account, market) ? _checkIsolatedMargin(account, market) : _checkCrossMargin(account)))
                revert IMarket.MarketInsufficientMarginError();
        }
    }

    /// @inheritdoc IMargin
    function postSettlement(address account, uint256 latestVersion) external onlyMarket {
        // process positions closes on settlement
        IMarket market = IMarket(msg.sender);
        if (market.hasPosition(account)) return; // TODO: replace with worthCasePosition == 0

        // If position is closed, deisolate all funds from the market
        _isolate(account, Fixed6Lib.from(-1, _balances[account][market]));

        // degegister market from cross margin
        if (crossed(account, market)) _uncross(account, market);
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
        // determine applicable market
        IMarket market = IMarket(msg.sender);
        if (crossed(account, market)) market = CROSS_MARGIN;

        // incorporate collateral updates into the checkpoint
        Checkpoint memory currentCheckpoint = _checkpoints[account][market][version].read();
        currentCheckpoint.incorporate(collateral, transfer, tradeFee, settlementFee);
        _checkpoints[account][market][version].store(currentCheckpoint);
        while (
            _current[account] > _incorporated[account] &&
            _checkpoints[account][market][_incorporated[account] + 1].read().pending == 0
        ) _incorporated[account] += 1;

        // initialize the checkpoint if it has not been initialized, and previous checkpoint is finalized
        while (
            _current[account] > _initialized[account] &&
            _incorporated[account] >= _initialized[account]
        ) {
            Checkpoint memory nextCheckpoint = _checkpoints[account][market][_initialized[account] + 1].read();
            nextCheckpoint.initialize(_checkpoints[account][market][_initialized[account]].read());
            _checkpoints[account][market][_initialized[account] + 1].store(nextCheckpoint);
            _initialized[account] += 1;
        }

        // update balance
        _balances[account][market] = _balances[account][market]
            .add(collateral.sub(Fixed6Lib.from(tradeFee)).sub(Fixed6Lib.from(settlementFee)));
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
    function _update(address account, Fixed6 amount) private {
        _requestCheckpoint(account, CROSS_MARGIN, 0, amount);

        if (amount.gt(Fixed6Lib.ZERO)) DSU.pull(msg.sender, UFixed18Lib.from(amount.abs()));
        if (amount.lt(Fixed6Lib.ZERO)) DSU.push(msg.sender, UFixed18Lib.from(amount.abs()));

        _balances[account][CROSS_MARGIN] = _balances[account][CROSS_MARGIN].add(amount);
        if (amount.lt(Fixed6Lib.ZERO) && !_checkCrossMargin(account))
            revert IMarket.MarketInsufficientMarginError();

        emit Updated(account, amount);
    }

    // TODO
    function _checkIsolatedMargin(address account, IMarket market) private view returns (bool) {
        // TODO: add stale check
        return _balances[account][market].gte(market.marginRequired(account));
        // TODO: add lt zero check
    }

    // TODO
    function _checkIsolatedMaintenance(address account, IMarket market) private view returns (bool) {
        // TODO: add stale check
        return _balances[account][market].gte(market.maintenanceRequired(account));
        // TODO: add lt zero check
    }

    // TODO
    function _checkCrossMargin(address account) private view returns (bool) {
        // TODO: add stale check
        UFixed6 totalRequirement;
        for (uint256 i; i < markets[account].length(); i++)
            totalRequirement = totalRequirement.add(markets[account].at(i).marginRequired(account, UFixed6Lib.ZERO));
        return _balances[account][CROSS_MARGIN].gte(totalRequirement);
        // TODO: add lt zero check
    }

    // TODO
    function _checkCrossMaintained(address account) private view returns (bool) {
        // TODO: add stale check
        UFixed6 totalRequirement;
        for (uint256 i; i < markets[account].length(); i++)
            totalRequirement = totalRequirement.add(markets[account].at(i).maintenanceRequired(account));
        return _balances[account][CROSS_MARGIN].gte(totalRequirement);
        // TODO: add lt zero check
    }

    // TODO
    function _requestCheckpoint(address account, IMarket market, uint256 version, Fixed6 transfer) private {
        Checkpoint memory currentCheckpoint = _checkpoints[account][market][version].read();

        // if empty, set pending to registered markets or 1 for isolated
        if (currentCheckpoint.empty())
            currentCheckpoint.pending = (market == CROSS_MARGIN ? markets[account].length() : 1);

        // update transfer
        currentCheckpoint.transfer = currentCheckpoint.transfer.add(transfer);

        // if cross margin, update all other markets
        if (market == CROSS_MARGIN)
            for (uint256 i; i < markets[account].length(); i++)
                if (markets[account].at(i) != market)
                    markets[account].at(i).update(account, Fixed6Lib.ZERO, address(0));
    }

    /// @dev Upserts a market into cross-margin collections
    function _cross(address account, IMarket market) private {
        if (markets[account].add(address(market))) emit MarketCrossed(account, market);
    }

    /// @dev Removes a market from cross-margin collections
    function _uncross(address account, IMarket market) private {
        if (markets[account].remove(address(market))) emit MarketUncrossed(account, market);
    }

    /// @dev Determines whether user has a position or pending order in a specific market
    function _hasPosition(address account, IMarket market) private view returns (bool) {
        return !market.positions(account).magnitude().isZero() || !market.pendings(account).isEmpty();
    }

    /// @dev Determines whether a market update occurred for a non-isolated market
    function crossed(address account, IMarket market) public view returns (bool) {
        return markets[account].length() != 0;
    }

    /// @dev Determines whether market is in isolated mode for a specific user
    function isolated(address account, IMarket market) public view returns (bool) {
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