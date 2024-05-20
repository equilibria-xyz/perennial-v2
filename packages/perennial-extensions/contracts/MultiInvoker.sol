// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { AggregatorV3Interface } from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import { IEmptySetReserve } from "@equilibria/emptyset-batcher/interfaces/IEmptySetReserve.sol";
import { IFactory } from "@equilibria/root/attribute/interfaces/IFactory.sol";
import { IBatcher } from "@equilibria/emptyset-batcher/interfaces/IBatcher.sol";
import { IInstance } from "@equilibria/root/attribute/interfaces/IInstance.sol";
import { IPythFactory } from "@equilibria/perennial-v2-oracle/contracts/interfaces/IPythFactory.sol";
import { IVault } from "@equilibria/perennial-v2-vault/contracts/interfaces/IVault.sol";
import "./interfaces/IMultiInvoker.sol";
import "./types/TriggerOrder.sol";
import "./types/InterfaceFee.sol";
import "@equilibria/root/attribute/Kept/Kept.sol";
import "@openzeppelin/contracts/utils/Address.sol";

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
    IFactory public immutable vaultFactory;

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

    /// @notice Constructs the MultiInvoker contract
    /// @param usdc_ USDC stablecoin address
    /// @param dsu_ DSU address
    /// @param marketFactory_ Protocol factory to validate market approvals
    /// @param vaultFactory_ Protocol factory to validate vault approvals
    /// @param batcher_ Batcher address
    /// @param reserve_ Reserve address
    /// @param keepBufferBase_ The fixed gas buffer that is added to the keeper fee
    /// @param keepBufferCalldata_ The fixed calldata buffer that is added to the keeper fee
    constructor(
        Token6 usdc_,
        Token18 dsu_,
        IFactory marketFactory_,
        IFactory vaultFactory_,
        IBatcher batcher_,
        IEmptySetReserve reserve_,
        uint256 keepBufferBase_,
        uint256 keepBufferCalldata_
    ) {
        USDC = usdc_;
        DSU = dsu_;
        marketFactory = marketFactory_;
        vaultFactory = vaultFactory_;
        batcher = batcher_;
        reserve = reserve_;
        keepBufferBase = keepBufferBase_;
        keepBufferCalldata = keepBufferCalldata_;
    }

    /// @notice Initialize the contract
    /// @param ethOracle_ Chainlink ETH/USD oracle address
    function initialize(AggregatorV3Interface ethOracle_) external initializer(1) {
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

    /// @notice entry to perform invocations
    /// @param invocations List of actions to execute in order
    function invoke(Invocation[] calldata invocations) external payable {
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

                _update(msg.sender, market, newMaker, newLong, newShort, collateral, wrap, interfaceFee1, interfaceFee2);
            } else if (invocation.action == PerennialAction.UPDATE_VAULT) {
                (IVault vault, UFixed6 depositAssets, UFixed6 redeemShares, UFixed6 claimAssets, bool wrap)
                    = abi.decode(invocation.args, (IVault, UFixed6, UFixed6, UFixed6, bool));

                _vaultUpdate(vault, depositAssets, redeemShares, claimAssets, wrap);
            } else if (invocation.action == PerennialAction.PLACE_ORDER) {
                (IMarket market, TriggerOrder memory order) = abi.decode(invocation.args, (IMarket, TriggerOrder));

                _placeOrder(msg.sender, market, order);
            } else if (invocation.action == PerennialAction.CANCEL_ORDER) {
                (IMarket market, uint256 nonce) = abi.decode(invocation.args, (IMarket, uint256));

                _cancelOrder(msg.sender, market, nonce);
            } else if (invocation.action == PerennialAction.EXEC_ORDER) {
                (address account, IMarket market, uint256 nonce)
                    = abi.decode(invocation.args, (address, IMarket, uint256));

                _executeOrder(account, market, nonce);
            } else if (invocation.action == PerennialAction.COMMIT_PRICE) {
                (address oracleProviderFactory, uint256 value, bytes32[] memory ids, uint256 version, bytes memory data, bool revertOnFailure) =
                    abi.decode(invocation.args, (address, uint256, bytes32[], uint256, bytes, bool));

                _commitPrice(oracleProviderFactory, value, ids, version, data, revertOnFailure);
            } else if (invocation.action == PerennialAction.APPROVE) {
                (address target) = abi.decode(invocation.args, (address));

                _approve(target);
            }
        }
        // Eth must not remain in this contract at rest
        payable(msg.sender).transfer(address(this).balance);
    }

    /// @notice Updates market on behalf of account
    /// @param account Address of account to update
    /// @param market Address of market up update
    /// @param newMaker New maker position for account in `market`
    /// @param newLong New long position for account in `market`
    /// @param newShort New short position for account in `market`
    /// @param collateral Net change in collateral for account in `market`
    /// @param wrap Wheather to wrap/unwrap collateral on deposit/withdrawal
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
        if (collateral.sign() == 1) _deposit(collateral.abs(), wrap);

        market.update(account, newMaker, newLong, newShort, collateral, false);

        Fixed6 withdrawAmount = Fixed6Lib.from(Fixed18Lib.from(DSU.balanceOf()).sub(balanceBefore));
        if (!withdrawAmount.isZero()) _withdraw(account, withdrawAmount.abs(), wrap);

        // charge interface fee
        _chargeFee(account, market, interfaceFee1);
        _chargeFee(account, market, interfaceFee2);
    }

    /// @notice Update vault on behalf of msg.sender
    /// @param vault Address of vault to update
    /// @param depositAssets Amount of assets to deposit into vault
    /// @param redeemShares Amount of shares to redeem from vault
    /// @param claimAssets Amount of assets to claim from vault
    /// @param wrap Whether to wrap assets before depositing
    function _vaultUpdate(
        IVault vault,
        UFixed6 depositAssets,
        UFixed6 redeemShares,
        UFixed6 claimAssets,
        bool wrap
    ) internal isVaultInstance(vault) {
        if (!depositAssets.isZero()) {
            _deposit(depositAssets, wrap);
        }

        UFixed18 balanceBefore = DSU.balanceOf();

        vault.update(msg.sender, depositAssets, redeemShares, claimAssets);

        // handle socialization, settlement fees, and magic values
        UFixed6 claimAmount = claimAssets.isZero() ?
            UFixed6Lib.ZERO :
            UFixed6Lib.from(DSU.balanceOf().sub(balanceBefore));

        if (!claimAmount.isZero()) {
            _withdraw(msg.sender, claimAmount, wrap);
        }
    }

    /// @notice Helper to max approve DSU for usage in a market or vault deployed by the registered factories
    /// @param target Market or Vault to approve
    function _approve(address target) internal {
        if (
            !marketFactory.instances(IInstance(target)) &&
            !vaultFactory.instances(IInstance(target))
        ) revert MultiInvokerInvalidInstanceError();

        DSU.approve(target);
    }

    /// @notice Charges an interface fee from collateral in this address during an update to a receiver
    /// @param account Account to charge fee from
    /// @param market Market to charge fee from
    /// @param interfaceFee Interface fee to charge
    function _chargeFee(address account, IMarket market, InterfaceFee memory interfaceFee) internal {
        if (interfaceFee.amount.isZero()) return;
        _marketWithdraw(market, account, interfaceFee.amount);

        if (interfaceFee.unwrap) _unwrap(interfaceFee.receiver, UFixed18Lib.from(interfaceFee.amount));
        else DSU.push(interfaceFee.receiver, UFixed18Lib.from(interfaceFee.amount));

        emit InterfaceFeeCharged(account, market, interfaceFee);
    }

    /// @notice Pull DSU or wrap and deposit USDC from msg.sender to this address for market usage
    /// @param amount Amount to transfer
    /// @param wrap Flag to wrap USDC to DSU
    function _deposit(UFixed6 amount, bool wrap) internal {
        if (wrap) {
            USDC.pull(msg.sender, amount);
            _wrap(address(this), UFixed18Lib.from(amount));
        } else {
            DSU.pull(msg.sender, UFixed18Lib.from(amount));
        }
    }

    /// @notice Push DSU or unwrap DSU to push USDC from this address to `account`
    /// @param account Account to push DSU or USDC to
    /// @param amount Amount to transfer
    /// @param wrap flag to unwrap DSU to USDC
    function _withdraw(address account, UFixed6 amount, bool wrap) internal {
        if (wrap) {
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
            reserve.redeem(amount);
            if (receiver != address(this)) USDC.push(receiver, UFixed6Lib.from(amount));
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

    /// @notice Places order on behalf of msg.sender from the invoker
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

    /// @notice Cancels an open order for msg.sender
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
        _marketWithdraw(market, account, UFixed6Lib.ZERO);
    }

    /// @notice Target market must be created by MarketFactory
    modifier isMarketInstance(IMarket market) {
        if (!marketFactory.instances(market))
            revert MultiInvokerInvalidInstanceError();
        _;
    }

    /// @notice Target vault must be created by VaultFactory
    modifier isVaultInstance(IVault vault) {
        if (!vaultFactory.instances(vault))
            revert MultiInvokerInvalidInstanceError();
        _;
    }
}
