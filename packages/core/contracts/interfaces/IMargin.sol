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
    /// @param account User whose claimable balance has changed
    /// @param amount Quantity of DSU credited to the user
    event ClaimableChanged(address indexed account, UFixed6 amount);

    /// @notice Emitted when user withdraws claimable balance
    /// @param account User from which claimable balance is withdrawn
    /// @param receiver Address to which DSU is transferred
    /// @param amount Quantity of DSU withdrawn
    event ClaimableWithdrawn(address indexed account, address indexed receiver, UFixed6 amount);

    /// @notice TODO
    event Updated(address indexed account, Fixed6 amount);

    /// @notice Emitted when cross-margin (non-isolated) balance has been adjusted
    /// @param account User whose cross-margin balance has changed
    /// @param amount Quantity of DSU added (positive) or removed (negative)
    event FundsChanged(address indexed account, Fixed6 amount);

    /// @notice Emitted when DSU funds are isolated to (positive) or deisolated from (negative) a market
    /// @param account User from which DSU is isolated/deisolated
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

    // TODO
    event MarketUncrossed(address indexed account, IMarket indexed market);

    // sig: 0x6e6b12f6
    /// custom:error User must have no position and no unsettled orders to switch between cross-margin and isolated collateral
    error MarginHasPositionError();

    // sig: 0x7eafe8a5
    /// custom:error Specified amount cannot be withdrawn or isolated; ensure funds are not isolated
    error MarginInsufficientCrossedBalanceError();

    // sig: 0xd3607011
    /// custom:error Specified amount cannot be crossed or removed from isolated balance;
    /// check amount currently isolated for specified market
    error MarginInsufficientIsolatedBalanceError();

    // sig: 0xbd9c1119
    /// custom:error A function intended only for a market to call was not called by a legitimate market
    error MarginInvalidMarketError();

    // sig: 0x77b81473
    /// custom:error User is not authorized for the requested action
    error MarginOperatorNotAllowedError();

    // sig: 0x44e4836d
    // custom:error Too many cross-margined markets
    error MarginTooManyCrossedMarketsError();

    /// @dev Limits iteration through cross-margined markets
    function MAX_CROSS_MARGIN_MARKETS() external view returns (uint256);

    /// @notice Retrieves the DSU token used as collateral for all markets
    function DSU() external view returns (Token18);

    /// @notice Retrieves the factory identifying the Perennial deployment
    function marketFactory() external view returns (IMarketFactory);

    /// @notice TODO
    function update(address account, Fixed6 amount) external;

    /// @notice Adjust specified amount of collateral isolated to a specific market,
    /// positive for isolation, negative for deisolation.
    /// If isolated collateral balance becomes zero, market is no longer isolated.
    /// @param account User whose isolated balance will be adjusted
    /// @param amount Quantity of collateral to designate as isolated
    function preUpdate(address account, Fixed6 amount) external;

    /// @notice Withdraws claimable balance
    /// @param account User whose claimable balance will be withdrawn
    /// @param receiver Claimed DSU will be transferred to this address
    /// @param feeReceived Amount of DSU transferred to receiver
    function claim(address account, address receiver) external returns (UFixed6 feeReceived);

    /// @dev TODO
    function postUpdate(address account, Fixed6 transfer, bool protected) external;

    /// @dev Called by market when Market.settle is called, used to implicitly deisolate when positions are closed.
    /// @param account User who was settled
    /// @param latestVersion Most recent version settled, used for updating checkpoint if necessary
    function postSettlement(address account, uint256 latestVersion) external;

    /// @dev Called by market to adjust claimable balance when fees are claimed or exposure settled
    function updateClaimable(address account, UFixed6 collateralDelta) external;

    /// @dev Called by market upon settlement, updates the account’s balance by a collateral delta,
    /// and writes checkpoints.
    /// @param account User whose collateral balance will be updated
    /// @param version Timestamp of the snapshot
    /// @param collateral Collateral delta (pnl, funding, and interest) calculated by the Local
    /// @param transfer Amount of collateral transferred from user to market
    /// @param tradeFee Amount of trade fees and spread accumulated at this settlement
    /// @param settlementFee Amount of settlement fees and liquidation fees accumulated at this settlement
    function postProcessLocal(
        address account,
        uint256 version,
        Fixed6 collateral,
        Fixed6 transfer,
        Fixed6 tradeFee,
        UFixed6 settlementFee
    ) external;

    /// @notice Retrieves the claimable balance for a user
    function claimables(address) external view returns (UFixed6);

    /// @notice Retrieves the isolated balance for a user and market
    function balances(address, IMarket) external view returns (UFixed6);

    /// @notice True if a market update occured for a non-isolated market for the user
    function crossed(address, IMarket) external view returns (bool);

    /// @notice True if market has a non-zero isolated balance for the user
    function isolated(address, IMarket) external view returns (bool);

    /// @notice Returns information about an account's isolated collateral for a specific version
    /// @param account User for whom the checkpoint is desired
    /// @param market Market for which user has collateral isolated
    /// @param version Identifies a point in time where market was settled
    function checkpoints(address account, IMarket market, uint256 version) external view returns (Checkpoint memory);
}
