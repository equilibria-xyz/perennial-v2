// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { IInstance } from "@equilibria/root/attribute/interfaces/IInstance.sol";
import { Fixed6 } from "@equilibria/root/number/types/Fixed6.sol";
import { UFixed6 } from "@equilibria/root/number/types/UFixed6.sol";
import { Token18 } from "@equilibria/root/token/types/Token18.sol";

import { Checkpoint } from "../types/Checkpoint.sol";
import { OracleVersion } from "../types/OracleVersion.sol";
import { IMarket, IMarketFactory } from "./IMarketFactory.sol";

interface IMargin is IInstance {
    /// @notice Emitted when claimable balance is updated by Market
    /// @param account Account whose claimable balance has changed
    /// @param amount Quantity of DSU credited (positive) or debited (negative, for exposure only)
    event ClaimableChanged(address indexed account, Fixed6 amount);

    /// @notice Emitted when user withdraws claimable balance
    /// @param account Account from which claimable balance is withdrawn
    /// @param receiver Address to which DSU is transferred
    /// @param amount Quantity of DSU withdrawn
    event ClaimableWithdrawn(address indexed account, address indexed receiver, UFixed6 amount);

    /// @notice Emitted when DSU is transferred into the margin contract, increasing the cross-margin balance
    /// @param account Account credited
    /// @param amount Quantity of DSU deposited
    event FundsDeposited(address indexed account, UFixed6 amount);

    /// @notice Emitted when DSU is transferred out of the margin contract, decreasing the cross-margin balance
    /// @param account Account debited
    /// @param amount Quantity of DSU withdrawn
    event FundsWithdrawn(address indexed account, UFixed6 amount);

    /// @notice Emitted when cross-margin (non-isolated) balance has been adjusted
    /// @param account Account whose cross-margin balance has changed
    /// @param amount Quantity of DSU added (positive) or removed (negative)
    event FundsChanged(address indexed account, Fixed6 amount);

    /// @notice Emitted when DSU funds are isolated to (positive) or deisolated from (negative) a market
    /// @param account Account from which DSU is isolated/deisolated
    /// @param market Market to which DSU is isolated/deisolated
    /// @param amount Quantity of DSU isolated/deisolated (change)
    event IsolatedFundsChanged(address indexed account, IMarket indexed market, Fixed6 amount);

    /// @notice Emitted when user takes a market out of isolated mode
    /// @param account Identifies the user
    /// @param market Market in which collateral will no longer be isolated
    event MarketCrossed(address indexed account, IMarket indexed market);

    /// @notice Emitted when user chooses to isolate collateral for a market
    /// @param account Identifies the user
    /// @param market Market in which collateral will be isolated
    event MarketIsolated(address indexed account, IMarket indexed market);

    // sig: 0x21d30123
    /// custom:error Market is cross-margined, but user called update with a collateral amount
    error MarginCannotUpdateCrossedMarket();

    // sig: 0xac13066a
    /// custom:error User must have no position to switch between cross-margin and isolated collateral
    error MarginHasPosition();

    // sig: 0x7bbdde3c
    /// custom:error Specified amount cannot be withdrawn or isolated; ensure funds are not isolated
    error MarginInsufficientCrossedBalance();

    // sig: 0x918aac34
    /// custom:error Specified amount cannot be crossed or removed from isolated balance;
    /// check amount currently isolated for specified market
    error MarginInsufficientIsolatedBalance();

    // sig: 0x8f8e8f6a
    /// custom:error A function intended only for a market to call was not called by a legitimate market
    error MarginInvalidMarket();

    // sig: 0xfbe67ca6
    /// custom:error Market is isolated, but user is trying to isolate again
    error MarginMarketNotCrossed();

    // sig: 0x3bccc5cf
    /// custom:error Market is crossed, but user is trying to adjust isolated balance or cross
    error MarginMarketNotIsolated();

    // sig: 0x77b81473
    /// custom:error User is not authorized for the requested action
    error MarginOperatorNotAllowedError();

    // sig: 0x9d4155b6
    // custom:error Too many cross-margined markets
    error MarginTooManyCrossedMarkets();

    /// @dev Limits iteration through cross-margined markets
    function MAX_CROSS_MARGIN_MARKETS() external view returns (uint256);

    /// @notice Retrieves the DSU token used as collateral for all markets
    function DSU() external view returns (Token18);

    /// @notice Retrieves the factory identifying the Perennial deployment
    function marketFactory() external view returns (IMarketFactory);

    /// @notice Pull DSU funds from sender and add to a cross-margin account
    /// @param account Account to be credited
    /// @param amount Quantity of DSU to pull from sender
    function deposit(address account, UFixed6 amount) external;

    /// @notice Remove DSU funds from the msg.sender's cross-margin account
    /// @param account Account to be debited, for which sender is authorized
    /// @param amount Quantity of DSU to push to sender
    function withdraw(address account, UFixed6 amount) external;

    /// @notice Adjust specified amount of collateral isolated to a specific market,
    /// positive for isolation, negative for deisolation.
    /// If isolated collateral balance becomes zero, market is no longer isolated.
    /// @param account User whose isolated balance will be adjusted
    /// @param amount Quantity of collateral to designate as isolated
    /// @param market Identifies where isolated balance should be adjusted
    function isolate(address account, IMarket market, Fixed6 amount) external;

    /// @notice Withdraws claimable balance
    /// @param account User whose claimable balance will be withdrawn
    /// @param receiver Claimed DSU will be transferred to this address
    /// @param feeReceived Amount of DSU transferred to receiver
    function claim(address account, address receiver) external returns (UFixed6 feeReceived);

    /// @dev Called by market to check maintenance requirements upon market update
    /// @param account User whose maintenance requirement will be checked
    /// @return isMaintained True if margin requirement met, otherwise false
    function maintained(
        address account
    ) external view returns (bool isMaintained);

    /// @dev Called by market to check margin requirements upon market update
    /// @param account User whose margin requirement will be checked
    /// @param minCollateralization Minimum collateralization specified on an intent, 0 if none
    /// @return isMargined True if margin requirement met, otherwise false
    function margined(
        address account,
        UFixed6 minCollateralization
    ) external view returns (bool isMargined);

    /// @dev Called by market when Market.update is called, used to adjust isolated collateral balance for market.
    /// @param account User intending to adjust isolated collateral for market
    /// @param collateralDelta Change in collateral requested by order prepared by market
    function handleMarketUpdate(address account, Fixed6 collateralDelta) external;

    // TODO: Once Market.claimExposure has been eliminated, make collateralDelta a UFixed6
    /// @dev Called by market to adjust claimable balance when fees are claimed or exposure settled
    function updateClaimable(address account, Fixed6 collateralDelta) external;

    /// @dev Called by market upon settlement, updates the account’s balance by a collateral delta,
    /// and credits claimable accounts for fees
    /// @param account User whose collateral balance will be updated
    /// @param version Timestamp of the snapshot
    /// @param latest Checkpoint prepared by the market
    /// @param pnl Collateral delta for the account prepared by the Local
    function updateCheckpoint(address account, uint256 version, Checkpoint memory latest, Fixed6 pnl) external;

    /// @notice Retrieves the claimable balance for a user
    function claimables(address) external view returns (Fixed6);

    /// @notice Retrieves the cross-margin balance for a user
    function crossMarginBalances(address) external view returns (Fixed6);

    /// @notice Retrieves the isolated balance for a user and market
    function isolatedBalances(address, IMarket) external view returns (Fixed6);

    /// @notice True if a market update occured for a non-isolated market for the user
    function isCrossed(address, IMarket) external view returns (bool);

    /// @notice True if market has a non-zero isolated balance for the user
    function isIsolated(address, IMarket) external view returns (bool);

    /// @notice Returns information about an account's collateral for a specific version
    /// @param account User for whom the checkpoint is desired
    /// @param market Market for which user has collateral isolated
    /// @param version Identifies a point in time where market was settled
    function isolatedCheckpoints(address account, IMarket market, uint256 version) external view returns (Checkpoint memory);
}