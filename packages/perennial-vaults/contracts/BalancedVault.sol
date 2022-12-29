//SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";
import "./interfaces/IBalancedVault.sol";
import "@equilibria/perennial-v2/contracts/interfaces/IMarket.sol";

/**
 * @title BalancedVault
 * @notice ERC4626 vault that manages a 50-50 position between long-short markets of the same payoff on Perennial.
 * @dev Vault deploys and rebalances collateral between the corresponding long and short markets, while attempting to
 *      maintain `targetLeverage` with its open positions at any given time. Withdrawals are gated by ensuring that
 *      leverage never exceeds `maxLeverage`. Deposits are only gated in so much as to cap the maximum amount of assets
 *      in the vault. A `fixedFloat` amount of assets are virtually set aside from the leverage calculation to ensure a
 *      fixed lower bound of assets are always allowed to be withdrawn from the vault.
 */
contract BalancedVault is IBalancedVault, ERC4626Upgradeable {
    UFixed6 constant private TWO = UFixed6.wrap(2e6);

    /// @dev The address of the Perennial factory contract
    IFactory public immutable factory;

    /// @dev The address of the Perennial market on the long side
    IMarket public immutable long;

    /// @dev The address of the Perennial market on the short side
    IMarket public immutable short;

    /// @dev The target leverage amount for the vault
    UFixed6 public immutable targetLeverage;

    /// @dev The maximum leverage amount for the vault
    UFixed6 public immutable maxLeverage;

    /// @dev The fixed amount that is "set aside" and not counted towards leverage calculations
    UFixed6 public immutable fixedFloat;

    /// @dev The collateral cap for the vault
    UFixed6 public immutable maxCollateral;

    constructor(
        IFactory factory_,
        IMarket long_,
        IMarket short_,
        UFixed6 targetLeverage_,
        UFixed6 maxLeverage_,
        UFixed6 fixedFloat_,
        UFixed6 maxCollateral_
    ) {
        if (targetLeverage_.gt(maxLeverage_)) revert BalancedVaultInvalidMaxLeverage();

        factory = factory_;
        long = long_;
        short = short_;
        targetLeverage = targetLeverage_;
        maxLeverage = maxLeverage_;
        fixedFloat = fixedFloat_;
        maxCollateral = maxCollateral_;
    }

    /**
     * @notice Initializes the contract
     * @param dsu_ The contract address of the DSU stablecoin
     */
    function initialize(IERC20Upgradeable dsu_) external initializer {
        __ERC20_init(
            string(abi.encodePacked("Perennial Balanced Vault: ", long.name())),
            string(abi.encodePacked("PBV-", long.symbol()))
        );
        __ERC4626_init(dsu_);

        dsu_.approve(address(long), type(uint256).max);
        dsu_.approve(address(short), type(uint256).max);
    }

    /**
     * @notice Rebalances the collateral and position of the vault without a deposit or withdraw
     * @dev Should be called by a keeper when the vault approaches a liquidation state on either side
     */
    function sync() external {
        _before();
        _update(UFixed6Lib.ZERO);
    }

    /**
     * @notice The total amount of assets currently held by the vault
     * @return Amount of assets held by the vault
     */
    function totalAssets() public override view returns (uint256) { //TODO: what if negative?
        (Fixed6 longCollateral, Fixed6 shortCollateral, UFixed18 idleCollateral) = _collateral();
        return uint256(
            int256(UFixed18.unwrap(idleCollateral)) +
            (Fixed6.unwrap(longCollateral) * 1e12) +
            (Fixed6.unwrap(shortCollateral) * 1e12)
        );
    }

    /**
     * @notice The maximum available withdrawal amount
     * @dev Only exact when vault is synced, otherwise approximate
     * @param owner The account to withdraw for
     * @return Maximum available withdrawal amount
     */
    function maxWithdraw(address owner) public view override returns (uint256) {
        // If we're in the middle of closing all positions due to liquidations, return 0.
        if (!healthy()) return 0;

        // Calculate the minimum amount of collateral we can have.
        UFixed6 price = _currentPrice(long).abs();
        UFixed6 position = long.accounts(address(this)).position.abs();

        // Calculate the minimum collateral for one market, which represents having a leverage of `maxLeverage`.
        ProtocolParameter memory _protocolParameter = factory.parameter();
        UFixed6 minimumCollateral = position.mul(price).div(maxLeverage);
        if (minimumCollateral.lt(_protocolParameter.minCollateral) && !minimumCollateral.isZero()) {
            minimumCollateral = _protocolParameter.minCollateral;
        }

        UFixed6 currentCollateral = _toUFixed6(totalAssets());
        if (currentCollateral.lt(minimumCollateral.mul(TWO))) return 0;

        return Math.min(super.maxWithdraw(owner), _toUint256(currentCollateral.sub(minimumCollateral.mul(TWO))));
    }

    /**
     * @notice The maximum available deposit amount
     * @dev Only exact when vault is synced, otherwise approximate
     * @param owner The account to deposit for
     * @return Maximum available deposit amount
     */
    function maxDeposit(address owner) public view override returns (uint256) {
        UFixed6 currentCollateral = _toUFixed6(totalAssets());
        UFixed6 availableDeposit = currentCollateral.gt(maxCollateral) ?
            UFixed6Lib.ZERO :
            maxCollateral.sub(currentCollateral);

        return Math.min(super.maxDeposit(owner), _toUint256(availableDeposit));
    }

    /**
     * @notice Deposits `assets` assets into the vault, returning shares to `receiver`
     * @param assets The amount of assets to deposit
     * @param receiver The account to receive the shares
     * @return The amount of shares returned to `receiver`
     */
    function deposit(uint256 assets, address receiver) public override returns (uint256) {
        _before();
        return super.deposit(assets, receiver);
    }

    /**
     * @notice Deposits `shares` worth of assets into the vault, returning shares to `receiver`
     * @param shares The amount of shares worth of assets to deposit
     * @param receiver The account to receive the shares
     * @return The amount of assets taken from `receiver`
     */
    function mint(uint256 shares, address receiver) public override returns (uint256) {
        _before();
        return super.mint(shares, receiver);
    }

    /**
     * @notice Withdraws `assets` assets from the vault, returning assets to `receiver`
     * @param assets The amount of assets to withdraw
     * @param owner The account to withdraw for (must be sender or approved)
     * @param receiver The account to receive the withdrawn assets
     * @return The amount of shares taken from `receiver`
     */
    function withdraw(uint256 assets, address receiver, address owner) public override returns (uint256) {
        _before();
        return super.withdraw(assets, receiver, owner);
    }

    /**
     * @notice Withdraws `shares` worth of assets into the vault, returning assets to `receiver`
     * @param shares The amount of shares worth of assets to withdraw
     * @param owner The account to withdraw for (must be sender or approved)
     * @param receiver The account to receive the withdrawn assets
     * @return The amount of assets returned to `receiver`
     */
    function redeem(uint256 shares, address receiver, address owner) public override returns (uint256) {
        _before();
        return super.redeem(shares, receiver, owner);
    }

    /**
     * @notice Returns whether the vault's positions have been been recently liquidated
     * @dev If one market's position is zero while the other is non-zero, this indicates a recent liquidation
     * @return Whether the vault is healthy
     */
    function healthy() public view returns (bool) {
        (bool isLongZero, bool isShortZero) =
            (long.accounts(address(this)).position.isZero(), short.accounts(address(this)).position.isZero());
        return isLongZero == isShortZero;
    }

    /**
     * @notice Deposits `assets` assets from `caller`, sending `shares` shares to `receiver`
     * @param caller The account that called the deposit
     * @param receiver The account to receive the shares
     * @param assets The amount of assets to deposit
     * @param shares The amount of shares to receive
     */
    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override {
        super._deposit(caller, receiver, assets, shares);
        _update(UFixed6Lib.ZERO);
    }

    /**
     * @notice Withdraws `assets` assets to `receiver`, taking `shares` shares from `owner`
     * @param caller The account that called the withdraw
     * @param receiver The account to receive the withdrawn assets
     * @param owner The account to withdraw for (must be caller or approved)
     * @param assets The amount of assets to withdraw
     * @param shares The amount of shares to be taken
     */
    function _withdraw(address caller, address receiver, address owner, uint256 assets, uint256 shares) internal override {
        _update(_toUFixed6(assets));
        super._withdraw(caller, receiver, owner, assets, shares);
    }

    /**
     * @notice Hook that is called before every stateful operation
     * @dev Settles the vault's account on both the long and short market
     */
    function _before() private {
        long.settle(address(this));
        short.settle(address(this));
    }

    /**
     * @notice Updates the vault's collateral and position given its current balance and parameters
     * @param withdrawalAmount The amount of assets that will be withdrawn from the vault at the end of the operation
     */
    function _update(UFixed6 withdrawalAmount) private {
        if (!healthy()) {
            _reset();
            return;
        }

        // Rebalance collateral if possible
        if (!_handleRetarget(withdrawalAmount)) _reset();
    }

    /**
     * @notice Resets the position of the vault to zero
     * @dev Called when an unhealthy state is detected
     */
    function _reset() private {
        long.update(Fixed6Lib.ZERO, long.accounts(address(this)).collateral);
        short.update(Fixed6Lib.ZERO, short.accounts(address(this)).collateral);
    }

    /**
     * @notice Rebalances the position of the vault
     * @dev Does not revert when rebalance fails, returns false instead allowing the vault to reset
     * @param withdrawalAmount The amount of assets that will be withdrawn from the vault at the end of the operation
     * @return Whether the rebalance occurred successfully
     */
    function _handleRetarget(UFixed6 withdrawalAmount) private returns (bool) {
        UFixed6 currentCollateral = _toUFixed6(totalAssets()).sub(withdrawalAmount);
        UFixed6 effectiveCollateral = currentCollateral.gt(fixedFloat) ? currentCollateral.sub(fixedFloat) : UFixed6Lib.ZERO;
        (Fixed6 longCollateral, Fixed6 shortCollateral, ) = _collateral(); //TODO: remove

        UFixed6 targetCollateral = currentCollateral.div(TWO);
        UFixed6 targetPosition = effectiveCollateral.mul(targetLeverage).div(_currentPrice(long).abs()).div(TWO);

        (IMarket greaterMarket, IMarket lesserMarket) = longCollateral.gt(shortCollateral) ? (long, short) : (short, long);
        return _retarget(greaterMarket, targetPosition, targetCollateral) && _retarget(lesserMarket, targetPosition, targetCollateral);
    }

    /**
     * @notice Adjusts the position on `market` to `targetPosition`
     * @param market The market to adjust the vault's position on
     * @param targetPosition The new position to target
     * @param targetCollateral The new collateral to target
     */
    function _retarget(IMarket market, UFixed6 targetPosition, UFixed6 targetCollateral) private returns (bool) {
        ProtocolParameter memory _protocolParameter = factory.parameter();
        Account memory _account = market.accounts(address(this));

        UFixed6 currentPosition = _account.next.abs();
        UFixed6 currentMaker = market.position().makerNext;
        UFixed6 makerLimit = market.parameter().makerLimit;
        UFixed6 buffer = makerLimit.gt(currentMaker) ? makerLimit.sub(currentMaker) : UFixed6Lib.ZERO;

        targetPosition = targetPosition.gt(currentPosition.add(buffer)) ? currentPosition.add(buffer) : targetPosition;
        targetCollateral = targetCollateral.gte(_protocolParameter.minCollateral) ? targetCollateral : UFixed6Lib.ZERO;

        try market.update(Fixed6Lib.from(-1, targetPosition), Fixed6Lib.from(targetCollateral)) { } catch { return false; }

        emit Updated(market, Fixed6Lib.from(-1, targetPosition), Fixed6Lib.from(targetCollateral));
        return true;
    }

    /**
     * @notice Returns the amounts of the individual sources of assets in the vault
     * @return The amount of collateral in the long market
     * @return The amount of collateral in the short market
     * @return The amount of collateral idle in the vault contract
     */
    function _collateral() private view returns (Fixed6, Fixed6, UFixed18) {
        return (
            long.accounts(address(this)).collateral,
            short.accounts(address(this)).collateral,
            Token18.wrap(asset()).balanceOf()
        );
    }

    function _toUint256(UFixed6 amount) private pure returns (uint256) {
        return UFixed6.unwrap(amount) * 1e12;
    }

    function _toUFixed6(uint256 amount) private pure returns (UFixed6) {
        return UFixed6.wrap(amount / 1e12);
    }

    function _currentPrice(IMarket market) private view returns (Fixed6) {
        MarketParameter memory _marketParameter = market.parameter();
        Position memory _position = market.position();
        OracleVersion memory oracleVersion = _marketParameter.oracle.atVersion(_position.latestVersion);
        _marketParameter.payoff.transform(oracleVersion);
        return oracleVersion.price;
    }

    function _maintenance(IMarket market) private view returns (UFixed6) {
        Account memory _account = market.accounts(address(this));
        UFixed6 maintenance_ = market.parameter().maintenance;
        UFixed6 notional = _account.position.mul(_currentPrice(market)).abs();
        return notional.mul(maintenance_);
    }

    function _maintenanceNext(IMarket market) private view returns (UFixed6) {
        Account memory _account = market.accounts(address(this));
        UFixed6 maintenance_ = market.parameter().maintenance;
        UFixed6 notional = _account.next.mul(_currentPrice(market)).abs();
        return notional.mul(maintenance_);
    }
}
