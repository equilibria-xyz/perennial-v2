// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { AggregatorV3Interface } from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import { IEmptySetReserve } from "@equilibria/emptyset-batcher/interfaces/IEmptySetReserve.sol";
import { IBatcher } from "@equilibria/emptyset-batcher/interfaces/IBatcher.sol";
import { IInstance } from "@equilibria/root/attribute/interfaces/IInstance.sol";
import { IFactory } from "@equilibria/root/attribute/interfaces/IFactory.sol";
import { Token6 } from "@equilibria/root/token/types/Token6.sol";
import { Token18 } from "@equilibria/root/token/types/Token18.sol";
import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { UFixed18, UFixed18Lib } from "@equilibria/root/number/types/UFixed18.sol";
import { Fixed6, Fixed6Lib } from "@equilibria/root/number/types/Fixed6.sol";
import { Fixed18, Fixed18Lib } from "@equilibria/root/number/types/Fixed18.sol";
import { Kept } from "@equilibria/root/attribute/Kept/Kept.sol";
import { IMarket } from "@perennial/v2-core/contracts/interfaces/IMarket.sol";
import { Order } from "@perennial/v2-core/contracts/types/Order.sol";
import { Position } from "@perennial/v2-core/contracts/types/Position.sol";
import { IPythFactory } from "@perennial/v2-oracle/contracts/interfaces/IPythFactory.sol";
import { IVault } from "@perennial/v2-vault/contracts/interfaces/IVault.sol";
import { Intent } from "@perennial/v2-core/contracts/types/Intent.sol";
import { IMultiInvoker } from "./interfaces/IMultiInvoker.sol";
import { TriggerOrder, TriggerOrderStorage } from "./types/TriggerOrder.sol";
import { InterfaceFee } from "./types/InterfaceFee.sol";

/// @title MultiInvoker
/// @notice Extension to handle batched calls to the Perennial protocol
contract MultiInvoker is IMultiInvoker, Kept {
    /// @dev USDC stablecoin address
    Token6 public immutable USDC; // solhint-disable-line var-name-mixedcase

    /// @dev DSU address
    Token18 public immutable DSU; // solhint-disable-line var-name-mixedcase

    /// @dev Protocol factory to validate market approvals
    IFactory public immutable marketFactory;

    /// @dev Vault factory to validate vault approvals
    IFactory public immutable makerVaultFactory;

    /// @dev Vault factory to validate vault approvals
    IFactory public immutable solverVaultFactory;

    /// @dev Batcher address
    IBatcher public immutable batcher;

    /// @dev Reserve address
    IEmptySetReserve public immutable reserve;

    /// @dev The fixed gas buffer that is added to the keeper fee
    uint256 public immutable keepBufferBase;

    /// @dev The fixed gas buffer that is added to the calldata portion of the keeper fee
    uint256 public immutable keepBufferCalldata;

    /// @dev UID for an order
    uint256 public latestNonce;

    /// @dev State for the order data
    mapping(address => mapping(IMarket => mapping(uint256 => TriggerOrderStorage))) private _orders;

    /// @dev Mapping of allowed operators for each account
    mapping(address => mapping(address => bool)) public operators;

    /// @dev Mapping of claimable DSU for each account
    mapping(address => UFixed6) public claimable;

    /// @notice Constructs the MultiInvoker contract
    /// @param usdc_ USDC stablecoin address
    /// @param dsu_ DSU address
    /// @param marketFactory_ Protocol factory to validate market approvals
    /// @param makerVaultFactory_ Protocol factory to validate maker vault approvals
    /// @param solverVaultFactory_ Protocol factory to validate solver vault approvals
    /// @param batcher_ Batcher address
    /// @param reserve_ Reserve address
    /// @param keepBufferBase_ The fixed gas buffer that is added to the keeper fee
    /// @param keepBufferCalldata_ The fixed calldata buffer that is added to the keeper fee
    constructor(
        Token6 usdc_,
        Token18 dsu_,
        IFactory marketFactory_,
        IFactory makerVaultFactory_,
        IFactory solverVaultFactory_,
        IBatcher batcher_,
        IEmptySetReserve reserve_,
        uint256 keepBufferBase_,
        uint256 keepBufferCalldata_
    ) {
        USDC = usdc_;
        DSU = dsu_;
        marketFactory = marketFactory_;
        makerVaultFactory = makerVaultFactory_;
        solverVaultFactory = solverVaultFactory_;
        batcher = batcher_;
        reserve = reserve_;
        keepBufferBase = keepBufferBase_;
        keepBufferCalldata = keepBufferCalldata_;
    }

    /// @notice Initialize the contract
    /// @param ethOracle_ Chainlink ETH/USD oracle address
    function initialize(AggregatorV3Interface ethOracle_) external initializer(2) {
        __Kept__initialize(ethOracle_, DSU);

        if (address(batcher) != address(0)) {
            DSU.approve(address(batcher));
            USDC.approve(address(batcher));
        }

        DSU.approve(address(reserve));
        USDC.approve(address(reserve));
    }

    /// @notice View function to get order state
    /// @param account Account to get open oder of
    /// @param market Market to get open order in
    /// @param nonce UID of order
    function orders(address account, IMarket market, uint256 nonce) public view returns (TriggerOrder memory) {
        return _orders[account][market][nonce].read();
    }

    /// @notice Returns whether an order can be executed
    /// @param account Account to get open oder of
    /// @param market Market to get open order in
    /// @param nonce UID of order
    /// @return canFill Whether the order can be executed
    function canExecuteOrder(address account, IMarket market, uint256 nonce) public view returns (bool) {
        TriggerOrder memory order = orders(account, market, nonce);
        if (order.fee.isZero()) return false;

        return order.fillable(market.oracle().latest());
    }

    /// @notice Updates the status of an operator for the caller
    /// @param operator The operator to update
    /// @param newEnabled The new status of the operator
    function updateOperator(address operator, bool newEnabled) external {
        operators[msg.sender][operator] = newEnabled;
        emit OperatorUpdated(msg.sender, operator, newEnabled);
    }

    /// @notice entry to perform invocations for msg.sender
    /// @param invocations List of actions to execute in order
    function invoke(Invocation[] calldata invocations) external payable {
        _invoke(msg.sender, invocations);
    }

    /// @notice entry to perform invocations for account
    /// @param account Account to perform invocations for
    /// @param invocations List of actions to execute in order
    function invoke(address account, Invocation[] calldata invocations) external payable {
        _invoke(account, invocations);
    }

    /// @notice withdraw DSU or unwrap DSU to withdraw USDC from this address to `account`
    /// @param account Account to claim fees for
    /// @param unwrap Whether to wrap/unwrap collateral on withdrawal
    function claim(address account, bool unwrap) external onlyOperator(account, msg.sender) {
        UFixed6 claimableAmount = claimable[account];
        claimable[account] = UFixed6Lib.ZERO;

        _withdraw(msg.sender, claimableAmount, unwrap);
    }

    /// @notice Performs a batch of invocations for an account
    /// @param account Account to perform invocations for
    /// @param invocations List of actions to execute in order
    function _invoke(address account, Invocation[] calldata invocations) private onlyOperator(account, msg.sender) {
        for(uint i = 0; i < invocations.length; ++i) {
            Invocation memory invocation = invocations[i];

            if (invocation.action == PerennialAction.UPDATE_POSITION) {
                (
                    // update data
                    IMarket market,
                    UFixed6 newMaker,
                    UFixed6 newLong,
                    UFixed6 newShort,
                    Fixed6 collateral,
                    bool wrap,
                    InterfaceFee memory interfaceFee1,
                    InterfaceFee memory interfaceFee2
                ) = abi.decode(invocation.args, (IMarket, UFixed6, UFixed6, UFixed6, Fixed6, bool, InterfaceFee, InterfaceFee));

                _update(account, market, newMaker, newLong, newShort, collateral, wrap, interfaceFee1, interfaceFee2);
            } else if (invocation.action == PerennialAction.UPDATE_INTENT) {
                (IMarket market, Intent memory intent, bytes memory signature) = abi.decode(invocation.args, (IMarket, Intent, bytes));

                _updateIntent(account, market, intent, signature);
            } else if (invocation.action == PerennialAction.UPDATE_VAULT) {
                (IVault vault, UFixed6 depositAssets, UFixed6 redeemShares, UFixed6 claimAssets, bool wrap)
                    = abi.decode(invocation.args, (IVault, UFixed6, UFixed6, UFixed6, bool));

                _vaultUpdate(account, vault, depositAssets, redeemShares, claimAssets, wrap);
            } else if (invocation.action == PerennialAction.PLACE_ORDER) {
                (IMarket market, TriggerOrder memory order) = abi.decode(invocation.args, (IMarket, TriggerOrder));

                _placeOrder(account, market, order);
            } else if (invocation.action == PerennialAction.CANCEL_ORDER) {
                (IMarket market, uint256 nonce) = abi.decode(invocation.args, (IMarket, uint256));

                _cancelOrder(account, market, nonce);
            } else if (invocation.action == PerennialAction.EXEC_ORDER) {
                (address execAccount, IMarket market, uint256 nonce)
                    = abi.decode(invocation.args, (address, IMarket, uint256));

                _executeOrder(execAccount, market, nonce);
            } else if (invocation.action == PerennialAction.COMMIT_PRICE) {
                (address oracleProviderFactory, uint256 value, bytes32[] memory ids, uint256 version, bytes memory data, bool revertOnFailure) =
                    abi.decode(invocation.args, (address, uint256, bytes32[], uint256, bytes, bool));

                _commitPrice(oracleProviderFactory, value, ids, version, data, revertOnFailure);
            } else if (invocation.action == PerennialAction.APPROVE) {
                (address target) = abi.decode(invocation.args, (address));

                _approve(target);
            } else if (invocation.action == PerennialAction.CLAIM_FEE) {
                (IMarket market, bool unwrap) = abi.decode(invocation.args, (IMarket, bool));
                _claimFee(account, market, unwrap);
            }
        }
        // ETH must not remain in this contract at rest
        Address.sendValue(payable(msg.sender), address(this).balance);
    }

    /// @notice Updates market on behalf of account
    /// @param account Address of account to update
    /// @param market Address of market up update
    /// @param newMaker New maker position for account in `market`
    /// @param newLong New long position for account in `market`
    /// @param newShort New short position for account in `market`
    /// @param collateral Net change in collateral for account in `market`
    /// @param wrap Whether to wrap/unwrap collateral on deposit/withdrawal
    /// @param interfaceFee1 Primary interface fee to charge
    /// @param interfaceFee2 Secondary interface fee to charge
    function _update(
        address account,
        IMarket market,
        UFixed6 newMaker,
        UFixed6 newLong,
        UFixed6 newShort,
        Fixed6 collateral,
        bool wrap,
        InterfaceFee memory interfaceFee1,
        InterfaceFee memory interfaceFee2
    ) internal isMarketInstance(market) {
        Fixed18 balanceBefore =  Fixed18Lib.from(DSU.balanceOf());

        // collateral is transferred here as DSU then an optional interface fee is charged from it
        if (collateral.sign() == 1) _deposit(account, collateral.abs(), wrap);

        market.update(
            account,
            newMaker,
            newLong,
            newShort,
            collateral,
            false,
            interfaceFee1.receiver == address(0) ? interfaceFee2.receiver : interfaceFee1.receiver
        );

        Fixed6 withdrawAmount = Fixed6Lib.from(Fixed18Lib.from(DSU.balanceOf()).sub(balanceBefore));
        if (!withdrawAmount.isZero()) _withdraw(account, withdrawAmount.abs(), wrap);

        // charge interface fee
        _chargeInterfaceFee(account, market, interfaceFee1);
        _chargeInterfaceFee(account, market, interfaceFee2);
    }

    /// @notice Fills an intent update on behalf of account
    /// @param account Address of account to update
    /// @param intent The intent that is being filled
    /// @param signature The signature of the intent that is being filled
    function _updateIntent(
        address account,
        IMarket market,
        Intent memory intent,
        bytes memory signature
    ) internal isMarketInstance(market) {
        market.update(account, intent, signature);
    }

    /// @notice Update vault on behalf of account
    /// @param account Address of account to update
    /// @param vault Address of vault to update
    /// @param depositAssets Amount of assets to deposit into vault
    /// @param redeemShares Amount of shares to redeem from vault
    /// @param claimAssets Amount of assets to claim from vault
    /// @param wrap Whether to wrap assets before depositing
    function _vaultUpdate(
        address account,
        IVault vault,
        UFixed6 depositAssets,
        UFixed6 redeemShares,
        UFixed6 claimAssets,
        bool wrap
    ) internal isVaultInstance(vault) {
        if (!depositAssets.isZero()) {
            _deposit(account, depositAssets, wrap);
        }

        UFixed18 balanceBefore = DSU.balanceOf();

        vault.update(account, depositAssets, redeemShares, claimAssets);

        // handle socialization, settlement fees, and magic values
        UFixed6 claimAmount = claimAssets.isZero() ?
            UFixed6Lib.ZERO :
            UFixed6Lib.from(DSU.balanceOf().sub(balanceBefore));

        if (!claimAmount.isZero()) {
            _withdraw(account, claimAmount, wrap);
        }
    }

    /// @notice Helper to max approve DSU for usage in a market or vault deployed by the registered factories
    /// @param target Market or Vault to approve
    function _approve(address target) internal {
        if (
            !marketFactory.instances(IInstance(target)) &&
            !makerVaultFactory.instances(IInstance(target)) &&
            !solverVaultFactory.instances(IInstance(target))
        ) revert MultiInvokerInvalidInstanceError();

        DSU.approve(target);
    }

    /// @notice Charges an additive interface fee from collateral in this address during an update to a receiver
    /// @param account Account to charge fee from
    /// @param market Market to charge fee from
    /// @param interfaceFee Interface fee to charge
    function _chargeInterfaceFee(address account, IMarket market, InterfaceFee memory interfaceFee) internal {
        if (interfaceFee.amount.isZero()) return;
        _marketWithdraw(market, account, interfaceFee.amount);

        claimable[interfaceFee.receiver] = claimable[interfaceFee.receiver].add(interfaceFee.amount);

        emit InterfaceFeeCharged(account, market, interfaceFee);
    }

    /// @notice Claims market fees, unwraps DSU, and pushes USDC to fee earner
    /// @param market Market from which fees should be claimed
    /// @param account Address of the user who earned fees
    /// @param unwrap Set true to unwrap DSU to USDC when withdrawing
    function _claimFee(address account, IMarket market, bool unwrap) internal isMarketInstance(market) {
        UFixed6 claimAmount = market.claimFee(account);
        _withdraw(account, claimAmount, unwrap);
    }

    /// @notice Pull DSU or wrap and deposit USDC from `account` to this address for market usage
    /// @param account Account to pull DSU or USDC from
    /// @param amount Amount to transfer
    /// @param wrap Flag to wrap USDC to DSU
    function _deposit(address account, UFixed6 amount, bool wrap) internal {
        if (wrap) {
            USDC.pull(account, amount);
            _wrap(address(this), UFixed18Lib.from(amount));
        } else {
            DSU.pull(account, UFixed18Lib.from(amount));
        }
    }

    /// @notice Push DSU or unwrap DSU to push USDC from this address to `account`
    /// @param account Account to push DSU or USDC to
    /// @param amount Amount to transfer
    /// @param unwrap flag to unwrap DSU to USDC
    function _withdraw(address account, UFixed6 amount, bool unwrap) internal {
        if (unwrap) {
            _unwrap(account, UFixed18Lib.from(amount));
        } else {
            DSU.push(account, UFixed18Lib.from(amount));
        }
    }

    /// @notice Helper function to wrap `amount` USDC from `address(this)` into DSU using the batcher or reserve
    /// @param receiver Address to receive the DSU
    /// @param amount Amount of USDC to wrap
    function _wrap(address receiver, UFixed18 amount) internal {
        // If the batcher is 0 or  doesn't have enough for this wrap, go directly to the reserve
        if (address(batcher) == address(0) || amount.gt(DSU.balanceOf(address(batcher)))) {
            reserve.mint(amount);
            if (receiver != address(this)) DSU.push(receiver, amount);
        } else {
            // Wrap the USDC into DSU and return to the receiver
            batcher.wrap(amount, receiver);
        }
    }

    /// @notice Helper function to unwrap `amount` DSU into USDC and send to `receiver`
    /// @param receiver Address to receive the USDC
    /// @param amount Amount of DSU to unwrap
    function _unwrap(address receiver, UFixed18 amount) internal {
        // If the batcher is 0 or doesn't have enough for this unwrap, go directly to the reserve
        if (address(batcher) == address(0) || amount.gt(UFixed18Lib.from(USDC.balanceOf(address(batcher))))) {
            UFixed6 balanceBefore = USDC.balanceOf(address(this));
            reserve.redeem(amount);
            if (receiver != address(this)) USDC.push(receiver, USDC.balanceOf(address(this)).sub(balanceBefore));
        } else {
            // Unwrap the DSU into USDC and return to the receiver
            batcher.unwrap(amount, receiver);
        }
    }

    /// @notice Helper function to commit a price to an oracle
    /// @param oracleProviderFactory Address of oracle provider factory
    /// @param value The ether value to pass on with the commit sub-call
    /// @param version Version of oracle to commit to
    /// @param data Data to commit to oracle
    /// @param revertOnFailure Whether to revert on sub-call failure
    function _commitPrice(
        address oracleProviderFactory,
        uint256 value,
        bytes32[] memory ids,
        uint256 version,
        bytes memory data,
        bool revertOnFailure
    ) internal {
        UFixed18 balanceBefore = DSU.balanceOf();

        try IPythFactory(oracleProviderFactory).commit{value: value}(ids, version, data) {
            // Return through keeper fee if any
            DSU.push(msg.sender, DSU.balanceOf().sub(balanceBefore));
        } catch (bytes memory reason) {
            if (revertOnFailure) Address.verifyCallResult(false, reason, "");
        }
    }

    /// @notice executes an `account's` open order for a `market` and pays a fee to `msg.sender`
    /// @param account Account to execute order of
    /// @param market Market to execute order for
    /// @param nonce Id of open order to index
    function _executeOrder(address account, IMarket market, uint256 nonce) internal {
        if (!canExecuteOrder(account, market, nonce)) revert MultiInvokerCantExecuteError();

        TriggerOrder memory order = orders(account, market, nonce);

        _handleKeeperFee(
            KeepConfig(
                UFixed18Lib.ZERO,
                keepBufferBase,
                UFixed18Lib.ZERO,
                keepBufferCalldata
            ),
            0,
            msg.data[0:0],
            0,
            abi.encode(account, market, order.fee)
        );

        _marketSettle(market, account);

        Order memory pending = market.pendings(account);
        Position memory currentPosition = market.positions(account);
        currentPosition.update(pending);

        Fixed6 collateral = order.execute(currentPosition);

        _update(
            account,
            market,
            currentPosition.maker,
            currentPosition.long,
            currentPosition.short,
            collateral,
            true,
            order.interfaceFee1,
            order.interfaceFee2
        );

        delete _orders[account][market][nonce];
        emit OrderExecuted(account, market, nonce);
    }

    /// @notice Helper function to raise keeper fee
    /// @param keeperFee Keeper fee to raise
    /// @param data Data to raise keeper fee with
    /// @return Amount of keeper fee raised
    function _raiseKeeperFee(UFixed18 keeperFee, bytes memory data) internal virtual override returns (UFixed18) {
        (address account, IMarket market, UFixed6 fee) = abi.decode(data, (address, IMarket, UFixed6));
        UFixed6 raisedKeeperFee = UFixed6Lib.from(keeperFee, true).min(fee);
        _marketWithdraw(market, account, raisedKeeperFee);

        return UFixed18Lib.from(raisedKeeperFee);
    }

    /// @notice Places order on behalf of account from the invoker
    /// @param account Account to place order for
    /// @param market Market to place order in
    /// @param order Order state to place
    function _placeOrder(
        address account,
        IMarket market,
        TriggerOrder memory order
    ) internal isMarketInstance(market) {
        if (order.fee.isZero()) revert MultiInvokerInvalidOrderError();
        if (order.comparison != -1 && order.comparison != 1) revert MultiInvokerInvalidOrderError();
        if (
            order.side > 3 ||                                       // Invalid side
            (order.side == 3 && order.delta.gte(Fixed6Lib.ZERO))    // Disallow placing orders that increase collateral
        ) revert MultiInvokerInvalidOrderError();

        _orders[account][market][++latestNonce].store(order);
        emit OrderPlaced(account, market, latestNonce, order);
    }

    /// @notice Cancels an open order for account
    /// @param account Account to cancel order for
    /// @param market Market order is open in
    /// @param nonce UID of order
    function _cancelOrder(address account, IMarket market, uint256 nonce) internal {
        delete _orders[account][market][nonce];
        emit OrderCancelled(account, market, nonce);
    }

    /// @notice Withdraws `withdrawal` from `account`'s `market` position
    /// @param market Market to withdraw from
    /// @param account Account to withdraw from
    /// @param withdrawal Amount to withdraw
    function _marketWithdraw(IMarket market, address account, UFixed6 withdrawal) private {
        market.update(account, UFixed6Lib.MAX, UFixed6Lib.MAX, UFixed6Lib.MAX, Fixed6Lib.from(-1, withdrawal), false);
    }

    /// @notice Settles `account`'s `market` position
    /// @param market Market to settle
    /// @param account Account to settle
    function _marketSettle(IMarket market, address account) private {
        market.settle(account);
    }

    /// @notice Target market must be created by MarketFactory
    modifier isMarketInstance(IMarket market) {
        if (!marketFactory.instances(market))
            revert MultiInvokerInvalidInstanceError();
        _;
    }

    /// @notice Target vault must be created by VaultFactory
    modifier isVaultInstance(IVault vault) {
        if (!makerVaultFactory.instances(vault) && !solverVaultFactory.instances(vault))
            revert MultiInvokerInvalidInstanceError();
        _;
    }

    /// @notice Only the account or an operator can call
    modifier onlyOperator(address account, address operator) {
        if (account != operator && !operators[account][msg.sender]) revert MultiInvokerUnauthorizedError();
        _;
    }
}
