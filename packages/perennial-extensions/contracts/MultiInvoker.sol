// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { AggregatorV3Interface } from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import { IEmptySetReserve } from "@equilibria/emptyset-batcher/interfaces/IEmptySetReserve.sol";
import { IFactory } from "@equilibria/root/attribute/interfaces/IFactory.sol";
import { IBatcher } from "@equilibria/emptyset-batcher/interfaces/IBatcher.sol";
import { IInstance } from "@equilibria/root/attribute/interfaces/IInstance.sol";
import { IPythOracle } from "@equilibria/perennial-v2-oracle/contracts/interfaces/IPythOracle.sol";
import { IVault } from "@equilibria/perennial-v2-vault/contracts/interfaces/IVault.sol";
import "./interfaces/IMultiInvoker.sol";
import "./types/TriggerOrder.sol";
import "@equilibria/root/attribute/Kept/Kept.sol";

/// @title MultiInvoker
/// @notice Extension to handle batched calls to the Perennial protocol
contract MultiInvoker is IMultiInvoker, Kept {
    /// @dev Gas buffer estimating remaining execution gas to include in fee to cover further instructions
    uint256 public constant GAS_BUFFER = 100000; // solhint-disable-line var-name-mixedcase

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

    /// @dev multiplier to charge accounts on top of gas cost for keeper executions
    UFixed6 public immutable keeperMultiplier;

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
    /// @param keeperMultiplier_ multiplier to charge accounts on top of gas cost for keeper executions
    constructor(
        Token6 usdc_,
        Token18 dsu_,
        IFactory marketFactory_,
        IFactory vaultFactory_,
        IBatcher batcher_,
        IEmptySetReserve reserve_,
        UFixed6 keeperMultiplier_
    ) {
        USDC = usdc_;
        DSU = dsu_;
        marketFactory = marketFactory_;
        vaultFactory = vaultFactory_;
        batcher = batcher_;
        reserve = reserve_;
        keeperMultiplier = keeperMultiplier_;
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
        (, Fixed6 latestPrice, ) = _latest(market, account);
        return order.fillable(latestPrice);
    }

    /// @notice entry to perform invocations
    /// @param invocations List of actions to execute in order
    function invoke(Invocation[] calldata invocations) external payable {
        for(uint i = 0; i < invocations.length; ++i) {
            Invocation memory invocation = invocations[i];

            if (invocation.action == PerennialAction.UPDATE_POSITION) {
                (
                    IMarket market,
                    UFixed6 newMaker,
                    UFixed6 newLong,
                    UFixed6 newShort,
                    Fixed6 collateral,
                    bool wrap
                ) = abi.decode(invocation.args, (IMarket, UFixed6, UFixed6, UFixed6, Fixed6, bool));

                _update(market, newMaker, newLong, newShort, collateral, wrap);
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
                (address account, IMarket market, uint256 nonce) =
                    abi.decode(invocation.args, (address, IMarket, uint256));

                _executeOrder(account, market, nonce);
            } else if (invocation.action == PerennialAction.COMMIT_PRICE) {
                (address oracleProvider, uint256 value, uint256 index, uint256 version, bytes memory data, bool revertOnFailure) =
                    abi.decode(invocation.args, (address, uint256, uint256, uint256, bytes, bool));

                _commitPrice(oracleProvider, value, index, version, data, revertOnFailure);
            } else if (invocation.action == PerennialAction.LIQUIDATE) {
                (IMarket market, address account) = abi.decode(invocation.args, (IMarket, address));

                _liquidate(IMarket(market), account);
            } else if (invocation.action == PerennialAction.APPROVE) {
                (address target) = abi.decode(invocation.args, (address));

                _approve(target);
            } else if (invocation.action == PerennialAction.CHARGE_FEE) {
                (address to, UFixed6 amount) = abi.decode(invocation.args, (address, UFixed6));

                USDC.pullTo(msg.sender, to, amount);
                emit FeeCharged(msg.sender, to, amount);
            }
        }
    }

    /// @notice Updates market on behalf of msg.sender
    /// @param market Address of market up update
    /// @param newMaker New maker position for msg.sender in `market`
    /// @param newLong New long position for msg.sender in `market`
    /// @param newShort New short position for msg.sender in `market`
    /// @param collateral Net change in collateral for msg.sender in `market`
    /// @param wrap Wheather to wrap/unwrap collateral on deposit/withdrawal
    function _update(
        IMarket market,
        UFixed6 newMaker,
        UFixed6 newLong,
        UFixed6 newShort,
        Fixed6 collateral,
        bool wrap
    ) internal isMarketInstance(market) {
        Fixed18 balanceBefore =  Fixed18Lib.from(DSU.balanceOf());
        // collateral is transferred from this address to the market, transfer from msg.sender to here
        if (collateral.sign() == 1) _deposit(collateral.abs(), wrap);

        market.update(msg.sender, newMaker, newLong, newShort, collateral, false);

        Fixed6 withdrawAmount = Fixed6Lib.from(Fixed18Lib.from(DSU.balanceOf()).sub(balanceBefore));
        // collateral is transferred from the market to this address, transfer to msg.sender from here
        if (!withdrawAmount.isZero()) _withdraw(msg.sender, withdrawAmount.abs(), wrap);
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

    /// @notice Liquidates an account for a specific market
    /// @param market Market to liquidate account in
    /// @param account Address of market to liquidate
    function _liquidate(IMarket market, address account) internal isMarketInstance(market) {
        (Position memory latestPosition, UFixed6 liquidationFee, UFixed6 closable) = _liquidationFee(market, account);

        Position memory currentPosition = market.pendingPositions(account, market.locals(account).currentId);
        currentPosition.adjust(latestPosition);

        market.update(
            account,
            currentPosition.maker.isZero() ? UFixed6Lib.ZERO : currentPosition.maker.sub(closable),
            currentPosition.long.isZero() ? UFixed6Lib.ZERO : currentPosition.long.sub(closable),
            currentPosition.short.isZero() ? UFixed6Lib.ZERO : currentPosition.short.sub(closable),
            Fixed6Lib.from(-1, liquidationFee),
            true
        );

        _withdraw(msg.sender, liquidationFee, true);
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

    /// @notice Helper function to wrap `amount` USDC from `msg.sender` into DSU using the batcher or reserve
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
    /// @param oracleProvider Address of oracle provider
    /// @param value The ether value to pass on with the commit sub-call
    /// @param version Version of oracle to commit to
    /// @param data Data to commit to oracle
    /// @param revertOnFailure Whether to revert on sub-call failure
    function _commitPrice(
        address oracleProvider,
        uint256 value,
        uint256 index,
        uint256 version,
        bytes memory data,
        bool revertOnFailure
    ) internal {
        UFixed18 balanceBefore = DSU.balanceOf();

        if (revertOnFailure) {
            IPythOracle(oracleProvider).commit{value: value}(index, version, data);
        } else {
            try IPythOracle(oracleProvider).commit{value: value}(index, version, data) { }
            catch { }
        }

        // Return through keeper reward if any
        DSU.push(msg.sender, DSU.balanceOf().sub(balanceBefore));
    }

    /// @notice Helper function to compute the liquidation fee for an account
    /// @param market Market to compute liquidation fee for
    /// @param account Account to compute liquidation fee for
    /// @return liquidationFee Liquidation fee for the account
    /// @return closable The amount of the position that can be closed
    function _liquidationFee(IMarket market, address account) internal view returns (Position memory, UFixed6, UFixed6) {
        // load information about liquidation
        RiskParameter memory riskParameter = market.riskParameter();
        (Position memory latestPosition, Fixed6 latestPrice, UFixed6 closableAmount) = _latest(market, account);

        // create placeholder order for liquidation fee calculation (fee is charged the same on all sides)
        Order memory placeholderOrder;
        placeholderOrder.maker = Fixed6Lib.from(closableAmount);

        return (
            latestPosition,
            placeholderOrder
                .liquidationFee(OracleVersion(latestPosition.timestamp, latestPrice, true), riskParameter)
                .min(UFixed6Lib.from(market.token().balanceOf(address(market)))),
            closableAmount
        );
    }

    /// @notice Helper function to compute the latest position and oracle version without a settlement
    /// @param market Market to compute latest position and oracle version for
    /// @param account Account to compute latest position and oracle version for
    /// @return latestPosition Latest position for the account
    /// @return latestPrice Latest oracle price for the account
    /// @return closableAmount Amount of position that can be closed
    function _latest(
        IMarket market,
        address account
    ) internal view returns (Position memory latestPosition, Fixed6 latestPrice, UFixed6 closableAmount) {
        // load latest price
        OracleVersion memory latestOracleVersion = market.oracle().latest();
        latestPrice = latestOracleVersion.price;
        IPayoffProvider payoff = market.payoff();
        if (address(payoff) != address(0)) latestPrice = payoff.payoff(latestPrice);

        // load latest settled position
        uint256 latestTimestamp = latestOracleVersion.timestamp;
        latestPosition = market.positions(account);
        closableAmount = latestPosition.magnitude();
        UFixed6 previousMagnitude = closableAmount;

        // scan pending position for any ready-to-be-settled positions
        Local memory local = market.locals(account);
        for (uint256 id = local.latestId + 1; id <= local.currentId; id++) {

            // load pending position
            Position memory pendingPosition = market.pendingPositions(account, id);
            pendingPosition.adjust(latestPosition);

            // virtual settlement
            if (pendingPosition.timestamp <= latestTimestamp) {
                if (!market.oracle().at(pendingPosition.timestamp).valid) latestPosition.invalidate(pendingPosition);
                latestPosition.update(pendingPosition);

                previousMagnitude = latestPosition.magnitude();
                closableAmount = previousMagnitude;

            // process pending positions
            } else {
                closableAmount = closableAmount
                    .sub(previousMagnitude.sub(pendingPosition.magnitude().min(previousMagnitude)));
                previousMagnitude = latestPosition.magnitude();
            }
        }
    }

    /**
     * @notice executes an `account's` open order for a `market` and pays a fee to `msg.sender`
     * @param account Account to execute order of
     * @param market Market to execute order for
     * @param nonce Id of open order to index
     */
    function _executeOrder(
        address account,
        IMarket market,
        uint256 nonce
    ) internal keep (
        UFixed18Lib.from(keeperMultiplier),
        GAS_BUFFER,
        COMMITMENT_BUFFER,
        abi.encode(account, market, orders(account, market, nonce).fee)
    ) {
        if (!canExecuteOrder(account, market, nonce)) revert MultiInvokerCantExecuteError();

        (Position memory latestPosition, , ) = _latest(market, account);
        Position memory currentPosition = market.pendingPositions(account, market.locals(account).currentId);
        currentPosition.adjust(latestPosition);

        orders(account, market, nonce).execute(currentPosition);

        market.update(
            account,
            currentPosition.maker,
            currentPosition.long,
            currentPosition.short,
            Fixed6Lib.ZERO,
            false
        );

        delete _orders[account][market][nonce];
        emit OrderExecuted(account, market, nonce, market.locals(account).currentId);
    }

    /// @notice Helper function to raise keeper fee
    /// @param keeperFee Keeper fee to raise
    /// @param data Data to raise keeper fee with
    function _raiseKeeperFee(UFixed18 keeperFee, bytes memory data) internal override {
        (address account, address market, UFixed6 fee) = abi.decode(data, (address, address, UFixed6));
        if (keeperFee.gt(UFixed18Lib.from(fee))) revert MultiInvokerMaxFeeExceededError();

        IMarket(market).update(
            account,
            UFixed6Lib.MAX,
            UFixed6Lib.MAX,
            UFixed6Lib.MAX,
            Fixed6Lib.from(Fixed18Lib.from(-1, keeperFee), true),
            false
        );

    }

    /// @notice Places order on behalf of msg.sender from the invoker
    /// @param account Account to place order for
    /// @param market Market to place order in
    /// @param order Order state to place
    function _placeOrder(address account, IMarket market, TriggerOrder memory order) internal isMarketInstance(market) {
        if (order.fee.isZero()) revert MultiInvokerInvalidOrderError();
        if (order.comparison != -1 && order.comparison != 1) revert MultiInvokerInvalidOrderError();
        if (order.side != 1 && order.side != 2) revert MultiInvokerInvalidOrderError();

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

    /// @notice Target market must be created by MarketFactory
    modifier isMarketInstance(IMarket market) {
        if(!marketFactory.instances(market))
            revert MultiInvokerInvalidInstanceError();
        _;
    }

    /// @notice Target vault must be created by VaultFactory
    modifier isVaultInstance(IVault vault) {
        if(!vaultFactory.instances(vault))
            revert MultiInvokerInvalidInstanceError();
            _;
    }

    // Hardcoded commitment data to reward order execution keepers. This is equivalent to 1.5 commitments
    bytes private constant COMMITMENT_BUFFER = hex"504e41550100000003b801000000030d00b51fb99e6397d379dd05b329086fc76dfbb9caa5bbb37ef5360e99438be75c525f0c0be508912eb9fab922abece6341c44da06b190192374889c67f7c1a3e5fb00012aa7e5ad9566fce27a7c8c97cba6e4365be9792974e282c740873e43c95814df1b3e127688671070704ec42b38cc6a6f95f6b951cb4086b22435923aaa2f37c00102eca153b456ee6056681cf17190ef1621a33dfaaec0603231be7b797f074d5eb108bf2b33ee05ffc0afc4a0e5a4843af114d26b920dbf8a22be9df1e102f85b5c0003d911a052b78cac5d52fce0b51c25e9900f74a21b7d2439f52917ca3bff023633625ffcbc82b1b284414c8bb4b6d9aa724149f64947900cb2b9c70ea9e030b1060006385031bd182a51b8fbe0f213a5b2b5ee3cfdf3abbc953eac86d121be6cda3cac484fe5bd6f5e51dd1b86d9b2eb57e3b779559eb19c544e2ae771dd3dff7e7594010800535fa45057377b4659797d5d2d1544af2348572c4c4087315b075ecbe8e5200628c0744cd1f257dd272cf343a74ff0844708792cc945c94d70e7bf0dab15be01097613ff5fc638144e2f1cace7c3a70b14b26396c34f90e4e5068442efff6519a07023b1ac3d3a29d652080a002a3849da4f947625768585f89db2196396f85e22010adee1cfa871be9af6e4963a74e5745922a2a85df65866579e36f95a270afbb2e13bb6d7834ffb650d77fe0a93728909fde2ce2409ac205e2e2d5c2c774b522920010b6f44547f9dea5c17d95e825f83cb00245078b9ff530d8e5110be51f28765db3224bce72bbbffd2e033a4abfb4ba47d963999290e72f524a479fe4fe370fc8ad0010ee5b72e65baf294981a48dc84f14a6a23275689d248ff75cd1971093efeaa34974977fde44b9188f0e63f8c64a03c8c4b9bac7cd40a47bdf1e4a88fc974f3e3c6000f8300a36d0b03597b8a7a27551ca1df0ba3944a15f03ce023cb57213310f405676e54f60ad42ba8a51781a11226bf9dd6172c1b773c65b7a9ae820413cceeb1f7001180c9812d530cc1e0279579d039a3a70aa6346421e6ea0cd48eaa5b6cafec3b91775f155b6c2b614c18564db79adba4847ea69ceda09e9e38a1e62a68bd9d0f7d0112a44f1444aceb3dc095cd1da02e211577f28d69c51ae5411cc6b11b8a06ac5c404a42f0e3c5a72298729ea20f997b70efe04434da98b172862501c0a28c3f4ec50164c426ff00000000001ae101faedac5851e32b9b23b5f9411a8c2bac4aae3ed4dd7b811dd1a72ea4aa7100000000001a9d0601415557560000000000051852620000271006c7ca52daf83e065b217471444494efd3e3138201005500e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43000002aaa8c245c0000000002a13f357fffffff80000000064c426fb0000000064c426fa000002aa21c5b16000000000254799b808ffe63ec87521ece36290e52781916f9ab87d3b362e3b723ba3345e05629ab210e244a1d6a83b24a5b881b1a4c919ed54547d24efc635ddc53c38add012ba33e2735e1fe1d7660d0b3f70c65653bd7acdb5635bcea4fef75a6f97972986148f31f007c84cd33da191f6d283cbd28dbb9ea99a1698df6776bdf1164262a8db682e7a0791f7ca03c6cebb3269d4ada728e3a6b7cc49da736066f34a5ab1480c3b6e504e41550100000003b801000000030d00b51fb99e6397d379dd05b329086fc76dfbb9caa5bbb37ef5360e99438be75c525f0c0be508912eb9fab922abece6341c44da06b190192374889c67f7c1a3e5fb00012aa7e5ad9566fce27a7c8c97cba6e4365be9792974e282c740873e43c95814df1b3e127688671070704ec42b38cc6a6f95f6b951cb4086b22435923aaa2f37c00102eca153b456ee6056681cf17190ef1621a33dfaaec0603231be7b797f074d5eb108bf2b33ee05ffc0afc4a0e5a4843af114d26b920dbf8a22be9df1e102f85b5c0003d911a052b78cac5d52fce0b51c25e9900f74a21b7d2439f52917ca3bff023633625ffcbc82b1b284414c8bb4b6d9aa724149f64947900cb2b9c70ea9e030b1060006385031bd182a51b8fbe0f213a5b2b5ee3cfdf3abbc953eac86d121be6cda3cac484fe5bd6f5e51dd1b86d9b2eb57e3b779559eb19c544e2ae771dd3dff7e7594010800535fa45057377b4659797d5d2d1544af2348572c4c4087315b075ecbe8e5200628c0744cd1f257dd272cf343a74ff0844708792cc945c94d70e7bf0dab15be01097613ff5fc638144e2f1cace7c3a70b14b26396c34f90e4e5068442efff6519a07023b1ac3d3a29d652080a002a3849da4f947625768585f89db2196396f85e22010adee1cfa871be9af6e4963a74e5745922a2a85df65866579e36f95a270afbb2e13bb6d7834ffb650d77fe0a93728909fde2ce2409ac205e2e2d5c2c774b522920010b6f44547f9dea5c17d95e825f83cb00245078b9ff530d8e5110be51f28765db3224bce72bbbffd2e033a4abfb4ba47d963999290e72f524a479fe4fe370";
}
