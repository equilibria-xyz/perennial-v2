// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import {
    AggregatorV3Interface, 
    Kept_Arbitrum
} from "@equilibria/root/attribute/Kept/Kept_Arbitrum.sol";
import { Token18, UFixed18 } from "@equilibria/root/token/types/Token18.sol";
import { IAccount } from "./interfaces/IAccount.sol";
import { IController } from "./interfaces/IController.sol";
import { IVerifier } from "./interfaces/IVerifier.sol";
import { Controller } from "./Controller.sol";
import { DeployAccount, DeployAccountLib } from "./types/DeployAccount.sol";

import "hardhat/console.sol";

contract Controller_Arbitrum is Controller, Kept_Arbitrum {
    // TODO: do we really need separate Keep config for each message type?
    KeepConfig public keepConfigDeploy;

    constructor(
        KeepConfig memory keepConfigDeploy_
    ) {
        keepConfigDeploy = keepConfigDeploy_;
    }

    /// @notice Configures message verification and keeper compensation
    /// @param verifier_ Contract used to validate EIP-712 message signatures
    /// @param chainlinkFeed_ ETH-USD price feed used for calculating keeper compensation
    /// @param keeperToken_ 18-decimal USD-pegged stable used to compensate keepers
    function initialize(
        IVerifier verifier_,
        AggregatorV3Interface chainlinkFeed_,
        Token18 keeperToken_
    ) external initializer(1) {
        __Instance__initialize();
        __Kept__initialize(chainlinkFeed_, keeperToken_);
        verifier = verifier_;
    }

    /// @inheritdoc IController
    function deployAccountWithSignature(
        DeployAccount calldata deployAccount_, 
        bytes calldata signature_
    ) 
        override external 
        keep(
            keepConfigDeploy, 
            abi.encode(deployAccount_, signature_), 
            0, 
            abi.encode(deployAccount_.action.account, deployAccount_.action.maxFee)
        )
    {
        IAccount account = _deployAccountWithSignature(deployAccount_, signature_);
        // approve controller to spend the account's keeper token
        account.approveController(Token18.unwrap(keeperToken()));
    }

    function _raiseKeeperFee(
        UFixed18 amount,
        bytes memory data
    ) internal override returns (UFixed18) {
        (address account, uint256 maxFee) = abi.decode(data, (address, uint256));
        // maxFee is a UFixed6; convert to 18-decimal precision
        UFixed18 raisedKeeperFee = amount.min(UFixed18.wrap(maxFee * 1e12));
        keeperToken().pull(account, raisedKeeperFee);
        return raisedKeeperFee;
    }
}
