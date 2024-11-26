// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { IInstance } from "@equilibria/root/attribute/interfaces/IInstance.sol";
import { Fixed6 } from "@equilibria/root/number/types/Fixed6.sol";
import { UFixed6 } from "@equilibria/root/number/types/UFixed6.sol";

import { Checkpoint } from "../types/Checkpoint.sol";
import { OracleVersion } from "../types/OracleVersion.sol";
import { IMarket } from "./IMarket.sol";

interface IMargin is IInstance {
    // sig: 0xc65f6a26
    /// custom:error Specified amount cannot be withdrawn or isolated; ensure funds are not isolated
    error MarginInsufficientCrossedBalance();

    // sig: 0x918aac34
    /// custom:error Specified amount cannot be crossed or removed from isolated balance;
    /// check amount currently isolated for specified market
    error MarginInsufficientIsolatedBalance();

    // sig: 0x21d30123
    /// custom:error Market is cross-margained, but user called update with a collateral amount
    error MarginCannotUpdateCrossedMarket();

    /// @notice Retrieves the cross-margin balance for a user
    function crossMarginBalances(address) external view returns (Fixed6);

    /// @notice Retrieves the isolated balance for a user and market
    function isolatedBalances(address, IMarket) external view returns (Fixed6);

    /// @notice Add DSU funds to the msg.sender's cross-margin account
    /// @param amount Quantity of DSU to pull from sender
    function deposit(UFixed6 amount) external;

    /// @notice Remove DSU funds from the msg.sender's cross-margin account
    /// @param amount Quantity of DSU to push to sender
    function withdraw(UFixed6 amount) external;

    /// @notice Disable cross-margin and designate specified portion of collateral to a specific market
    /// @param amount Quantity of collateral to designate
    /// @param market Identifies where cross-margin should be disabled and collateral deposited
    function isolate(UFixed6 amount, IMarket market) external;

    /// @notice Enable cross-margin and designate all collateral from that market as cross-margin
    /// @param market Identifies where cross-margin should be enabled, and collateral withdrawn
    function cross(IMarket market) external;

    /// @notice Settles all registered markets for account and calculates whether maintenance requirements are met
    /// @param account User to settle and for whom maintenance requirement will be checked
    /// @return isMaintained True if maintenance requirement met, otherwise false
    function maintained(address account) external returns (bool isMaintained);

    /// @notice Settles all registered markets for account and calculates whether margin requirements are met
    /// @param account User to settle and for whom margin requirements will be checked
    /// @return isMargined True if margin requirements met, otherwise false
    function margined(address account) external returns (bool isMargined);

    /// @dev Called by market (through InvariantLib) to check maintenance requirements upon market update
    /// @param account User whose maintenance requirement will be checked
    /// @param positionMagnitude Size of the user's position
    /// @param latestVersion Identifies market price
    /// @return isMaintained True if margin requirement met, otherwise false
    function checkMaintained(
        address account,
        UFixed6 positionMagnitude,
        OracleVersion calldata latestVersion
    ) external returns (bool isMaintained);

    /// @dev Called by market (through InvariantLib) to check margin requirements upon market update
    /// @param account User whose margin requirement will be checked
    /// @param positionMagnitude Size of the user's position
    /// @param latestVersion Identifies market price
    /// @param minCollateralization Minimum collateralization specified on an intent, 0 if none
    /// @return isMargined True if margin requirement met, otherwise false
    function checkMargained(
        address account,
        UFixed6 positionMagnitude,
        OracleVersion calldata latestVersion,
        UFixed6 minCollateralization
    ) external returns (bool isMargined);

    /// @dev Called by market when Market.update is called, used to adjust isolated collateral balance for market.
    /// @param account User intending to adjust isolated collateral for market
    /// @param collateralDelta Change in collateral requested by order prepared by market
    function handleMarketUpdate(address account, Fixed6 collateralDelta) external;

    /// @dev Called by market when fees are claimed or exposure settled
    function updateBalance(address account, Fixed6 collateralDelta) external;

    /// @dev Called by market upon settlement, updates the account’s balance by a collateral delta,
    /// and credits claimable accounts for fees
    /// @param account User whose collateral balance will be updated
    /// @param version Timestamp of the snapshot
    /// @param latest Checkpoint prepared by the market
    /// @param pnl Collateral delta for the account prepared by the Local
    function updateCheckpoint(address account, uint256 version, Checkpoint memory latest, Fixed6 pnl) external;

    /// @notice Returns information about an account's collateral for a specific version
    /// @param account User for whom the checkpoint is desired
    /// @param market Market for which user has collateral isolated
    /// @param version Identifies a point in time where market was settled
    function isolatedCheckpoints(address account, IMarket market, uint256 version) external view returns (Checkpoint memory);
}