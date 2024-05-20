// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import { IBatcher } from "@equilibria/emptyset-batcher/interfaces/IBatcher.sol";
import { IEmptySetReserve } from "@equilibria/emptyset-batcher/interfaces/IEmptySetReserve.sol";
import {
    AggregatorV3Interface, 
    Kept_Arbitrum
} from "@equilibria/root/attribute/Kept/Kept_Arbitrum.sol";
import { Token6 } from "@equilibria/root/token/types/Token6.sol";
import { Token18, UFixed18 } from "@equilibria/root/token/types/Token18.sol";

import { IAccount } from "./interfaces/IAccount.sol";
import { IController } from "./interfaces/IController.sol";
import { IVerifier } from "./interfaces/IVerifier.sol";
import { Controller } from "./Controller.sol";
import { DeployAccount } from "./types/DeployAccount.sol";
import { SignerUpdate } from "./types/SignerUpdate.sol";
import { Withdrawal } from "./types/Withdrawal.sol";

/// @title Controller_Arbitrum
/// @notice Controller which compensates keepers for processing messages on Arbitrum
contract Controller_Arbitrum is Controller, Kept_Arbitrum {
    KeepConfig public keepConfig;

    constructor(
        KeepConfig memory keepConfig_
    ) {
        keepConfig = keepConfig_;
    }

    /// @notice Configures message verification and keeper compensation
    /// @param verifier_ Contract used to validate EIP-712 message signatures
    /// @param usdc_ USDC token address
    /// @param dsu_ DSU token address
    /// @param reserve_ DSU Reserve address, used by Account
    /// @param chainlinkFeed_ ETH-USD price feed used for calculating keeper compensation
    function initialize(
        IVerifier verifier_,
        Token6 usdc_,
        Token18 dsu_,
        IEmptySetReserve reserve_,
        AggregatorV3Interface chainlinkFeed_
    ) external initializer(1) {
        __Instance__initialize();
        __Kept__initialize(chainlinkFeed_, dsu_);
        verifier = verifier_;
        USDC = usdc_;
        DSU = dsu_;
        reserve = reserve_;
    }

    /// @inheritdoc IController
    function deployAccountWithSignature(
        DeployAccount calldata deployAccount_, 
        bytes calldata signature
    ) 
        override external 
        keep(
            keepConfig, 
            abi.encode(deployAccount_, signature), 
            0, 
            abi.encode(deployAccount_.action.account, deployAccount_.action.maxFee)
        )
    {
        _deployAccountWithSignature(deployAccount_, signature);
    }

    /// @inheritdoc IController
    function updateSignerWithSignature(
        SignerUpdate calldata signerUpdate, 
        bytes calldata signature
    ) 
        override external
        keep(
            keepConfig, 
            abi.encode(signerUpdate, signature), 
            0, 
            abi.encode(signerUpdate.action.account, signerUpdate.action.maxFee)
        )
    {
        _updateSignerWithSignature(signerUpdate, signature);
    }

    /// @inheritdoc IController
    function withdrawWithSignature(
        Withdrawal calldata withdrawal, 
        bytes calldata signature
    ) 
        override external 
        keep(
            keepConfig, 
            abi.encode(withdrawal, signature), 
            0, 
            abi.encode(withdrawal.action.account, withdrawal.action.maxFee)
        )
    {
        _withdrawWithSignature(withdrawal, signature);
    }

    /// @dev Transfers funds from collateral account to controller, and limits compensation 
    /// to the user-defined maxFee in the Action message
    /// @param amount Calculated keeper fee
    /// @param data Encoded address of collateral account and UFixed6 user-specified maximum fee
    /// @return raisedKeeperFee Amount pulled from controller to keeper
    function _raiseKeeperFee(
        UFixed18 amount,
        bytes memory data
    ) internal override returns (UFixed18 raisedKeeperFee) {
        (address account, uint256 maxFee) = abi.decode(data, (address, uint256));
        // maxFee is a UFixed6; convert to 18-decimal precision
        raisedKeeperFee = amount.min(UFixed18.wrap(maxFee * 1e12));
        keeperToken().pull(account, raisedKeeperFee);
    }
}
