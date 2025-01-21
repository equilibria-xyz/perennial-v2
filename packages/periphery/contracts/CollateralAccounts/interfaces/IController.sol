// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Fixed6 } from "@equilibria/root/number/types/Fixed6.sol";
import { UFixed6 } from "@equilibria/root/number/types/UFixed6.sol";
import { Token6 } from "@equilibria/root/token/types/Token6.sol";
import { Token18 } from "@equilibria/root/token/types/Token18.sol";
import { IMarketFactory } from "@perennial/v2-core/contracts/interfaces/IMarketFactory.sol";

import { IAccount, IMarket } from "../interfaces/IAccount.sol";
import { IAccountVerifier } from "../interfaces/IAccountVerifier.sol";
import { DeployAccount } from "../types/DeployAccount.sol";
import { MarketTransfer } from "../types/MarketTransfer.sol";
import { RebalanceConfig } from "../types/RebalanceConfig.sol";
import { RebalanceConfigChange } from "../types/RebalanceConfigChange.sol";
import { Withdrawal } from "../types/Withdrawal.sol";

/// @notice Facilitates unpermissioned actions between collateral accounts and markets
interface IController {
    /// @notice Emitted when a collateral account is deployed
    /// @param owner EOA for whom the collateral account was created
    /// @param account contract address of the collateral account
    event AccountDeployed(address indexed owner, IAccount indexed account);

    /// @notice Emitted when a group has been rebalanced
    /// @param owner Owner of the collateral account for which the rebalance group was created or modified
    /// @param group Identifies the rebalance group within context of owner
    event GroupRebalanced(address indexed owner, uint256 indexed group);

    /// @notice Emitted when a rebalance group is created or updated
    /// @param owner Owner of the collateral account for which the rebalance group was created or modified
    /// @param group Identifies the rebalance group within context of owner
    /// @param markets Number of markets in the group (0 if group was deleted)
    event RebalanceGroupConfigured(address indexed owner, uint256 indexed group, uint256 markets);

    /// @notice Emitted for each market in a rebalance group upon creation of the group
    /// or when any changes are made to the group
    /// @param owner Owner of the collateral account for which the rebalance group was created or modified
    /// @param group Identifies the rebalance group within context of owner
    /// @param market The Perennial market for which this configuration applies
    /// @param newConfig Rebalance configuration for the market, which may or may not have changed
    event RebalanceMarketConfigured(
        address indexed owner,
        uint256 indexed group,
        address indexed market,
        RebalanceConfig newConfig
    );

    // sig: 0xdc72f280
    /// @custom:error Group is balanced and ineligible for rebalance
    error ControllerGroupBalancedError();

    // sig: 0x191c84f2
    /// @custom:error Caller has not be authorized as an operator of the owner of the collateral account
    error ControllerNotOperatorError();

    // sig: 0xbd3648e9
    /// @custom:error A RebalanceConfigChange message had a mismatch in number of markets and configs
    error ControllerInvalidRebalanceConfigError();

    // sig: 0xa16ba7f2
    /// @custom:error Group number was out-of-range; each collateral account may have up to 8 groups, indexed 1-8
    error ControllerInvalidRebalanceGroupError();

    // sig: 0xecce9fda
    /// @custom:error Group has too many markets; each group may have 1-4 markets
    error ControllerInvalidRebalanceMarketsError();

    // sig: 0x64580a1c
    /// @custom:error The sum of `target` collateral allocations for each market in a group does not total 100%.
    /// This could also indicate a duplicate market was in the list.
    error ControllerInvalidRebalanceTargetsError();

    // sig: 0x43e749f8
    /// @custom:error Signer is not authorized to interact with the specified collateral account
    error ControllerInvalidSignerError();

    // sig: 0xa4a79a03
    /// @custom:error A market in this rebalancing configuration is already a member of a different group
    /// @param market Identifies which market in the message which is causing the problem
    /// @param group Identifies the group in which the aforementioned market is a member
    error ControllerMarketAlreadyInGroupError(IMarket market, uint256 group);

    // sig: 0xdcca49cd
    /// @custom:error Attempt to interact with a Market which does not use DSU as collateral
    /// @param market Market with non-DSU collateral
    error ControllerUnsupportedMarketError(IMarket market);

    /// @dev Contract used to validate delegated signers and relay certain messages
    function marketFactory() external view returns (IMarketFactory);

    /// @dev Contract used to validate message signatures
    function verifier() external view returns (IAccountVerifier);

    /// @notice Sets contract addresses used for message verification and token management
    /// @param verifier Contract used to validate collateral account message signatures
    function initialize(
        IAccountVerifier verifier
    ) external;

    /// @notice Returns the deterministic address of the collateral account for a user,
    /// regardless of whether or not it exists.
    /// @param owner Identifies the user whose collateral account address is desired
    function getAccountAddress(address owner) external view returns (address);

    /// @notice Deploys the collateral account for msg.sender and returns the address of the account
    function deployAccount() external returns (IAccount);

    /// @notice Deploys a collateral account via a signed message
    /// @param deployAccountAction Message requesting creation of a collateral account
    /// @param signature ERC712 message signature
    function deployAccountWithSignature(DeployAccount calldata deployAccountAction, bytes calldata signature) external;

    /// @notice Transfers tokens between a collateral account and a specified Perennial Market
    /// @param marketTransfer Message requesting a deposit to or withdrawal from the Market
    /// @param signature ERC712 message signature
    function marketTransferWithSignature(MarketTransfer calldata marketTransfer, bytes calldata signature) external;

    /// @notice Adjusts the rebalancing configuration of one or more markets
    /// @param configChange Message with new rebalance group configuration
    /// @param signature ERC712 message signature
    function changeRebalanceConfigWithSignature(RebalanceConfigChange calldata configChange,
        bytes calldata signature) external;

    /// @notice Checks all markets in a rebalance group to see if anything may be rebalanced
    /// @param owner User whose collateral account may be rebalanced using this group
    /// @param group Identifies the group within the context of the owner
    /// @return groupCollateral Sum of ower's collateral across each market in the group
    /// @return canRebalance True if one or more markets in the group are eligible for rebalancing
    /// @return imbalances The difference between target and actual collateral for each market
    function checkGroup(address owner, uint256 group) external view returns (
        Fixed6 groupCollateral,
        bool canRebalance,
        Fixed6[] memory imbalances
    );

    /// @notice Called by keepers to rebalance an unbalanced group
    /// @param owner User whose collateral account may be rebalanced using this group
    /// @param group Identifies the group within the context of the owner
    function rebalanceGroup(address owner, uint256 group) external;

    /// @notice Retrieves rebalance configuration for a specified owner, group, and market
    /// @param owner User for whom the collateral account was created
    /// @param group Identifies a collection of markets, each with their own configuration
    /// @param market Identifies which Perennial market for which the configuration is desired
    function rebalanceConfigs(
        address owner,
        uint256 group,
        address market
    ) external view returns (RebalanceConfig memory);

    /// @notice Retrieves array of markets in an owner's rebalance group
    /// @param owner User for whom the collateral account was created
    /// @param group Identifies which collection of markets is desired for the owner
    /// @return markets Array containing each market in the rebalance group
    function rebalanceGroupMarkets(
        address owner,
        uint256 group
    ) external view returns (IMarket[] memory markets);

    /// @notice Transfers tokens from the collateral account back to the owner of the account
    /// @param withdrawal Message requesting a withdrawal
    /// @param signature ERC712 message signature
    function withdrawWithSignature(Withdrawal calldata withdrawal, bytes calldata signature) external;

    /// @notice Allows an operator to withdraw funds from the owner's account to pay fees
    /// @param owner Used to determine the collateral account to charge
    /// @param amount Quantity of DSU to transfer to the sender
    function chargeFee(address owner, UFixed6 amount) external;
}
