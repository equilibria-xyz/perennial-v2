// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import {
    AggregatorV3Interface, 
    Kept_Arbitrum
} from "@equilibria/root/attribute/Kept/Kept_Arbitrum.sol";
import { Fixed6, Fixed6Lib } from "@equilibria/root/number/types/Fixed6.sol";
import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { Token18, UFixed18 } from "@equilibria/root/token/types/Token18.sol";
import { IMarket } from "@equilibria/perennial-v2/contracts/interfaces/IMarket.sol";

import { IAccount } from "./interfaces/IAccount.sol";
import { IController } from "./interfaces/IController.sol";
import { IVerifier } from "./interfaces/IVerifier.sol";
import { Controller } from "./Controller.sol";
import { DeployAccount } from "./types/DeployAccount.sol";
import { MarketTransfer } from "./types/MarketTransfer.sol";
import { SignerUpdate } from "./types/SignerUpdate.sol";
import { Withdrawal } from "./types/Withdrawal.sol";

/// @notice Controller which compensates keepers for processing messages on Arbitrum L2.
contract Controller_Arbitrum is Controller, Kept_Arbitrum {
    KeepConfig public keepConfig;

    constructor(
        KeepConfig memory keepConfig_
    ) {
        keepConfig = keepConfig_;
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
            keepConfig, 
            abi.encode(deployAccount_, signature_), 
            0, 
            abi.encode(deployAccount_.action.account, deployAccount_.action.maxFee)
        )
    {
        IAccount account = _deployAccountWithSignature(deployAccount_, signature_);
        // approve controller to spend the account's keeper token
        account.approveController(Token18.unwrap(keeperToken()));
    }

    /// @inheritdoc IController
    function marketTransferWithSignature(
        MarketTransfer calldata marketTransfer_, 
        bytes calldata signature_
    )
        override external
    {
        IAccount account = _verifyMarketTransfer(marketTransfer_, signature_);
        IMarket market = IMarket(marketTransfer_.market);
        Fixed6 amount = marketTransfer_.amount;
        bytes memory data = abi.encode(marketTransfer_.action.account, marketTransfer_.action.maxFee);

        // if we're depositing collateral to the market, pay the keeper before transferring funds
        if (amount.gte(Fixed6Lib.ZERO)) {
            _handleKeeperFee(keepConfig, 0, msg.data[0:0], 0, data);
            account.marketTransfer(market, amount);
        // otherwise handle the keeper fee normally, after withdrawing to the collateral account
        } else {
            account.marketTransfer(market, amount);
            _handleKeeperFee(keepConfig, 0, msg.data[0:0], 0, data);
        }
    }

    /// @inheritdoc IController
    function updateSignerWithSignature(
        SignerUpdate calldata signerUpdate_, 
        bytes calldata signature_
    ) 
        override external
        keep(
            keepConfig, 
            abi.encode(signerUpdate_, signature_), 
            0, 
            abi.encode(signerUpdate_.action.account, signerUpdate_.action.maxFee)
        )
    {
        _updateSignerWithSignature(signerUpdate_, signature_);
    }

    /// @inheritdoc IController
    function withdrawWithSignature(
        Withdrawal calldata withdrawal_, 
        bytes calldata signature_
    ) 
        override external 
        keep(
            keepConfig, 
            abi.encode(withdrawal_, signature_), 
            0, 
            abi.encode(withdrawal_.action.account, withdrawal_.action.maxFee)
        )
    {
        _withdrawWithSignature(withdrawal_, signature_);
    }

    /// @dev Transfers funds from collateral account to controller, and limits compensation 
    /// to the user-defined maxFee in the Action message
    /// @param amount Calculated keeper fee
    /// @param data Encoded address of collateral account and UFixed6 user-specified maximum fee
    /// @return raisedKeeperFee_ Amount pulled from controller to keeper
    function _raiseKeeperFee(
        UFixed18 amount,
        bytes memory data
    ) internal override returns (UFixed18 raisedKeeperFee_) {
        (address account, uint256 maxFee) = abi.decode(data, (address, uint256));
        // maxFee is a UFixed6; convert to 18-decimal precision
        raisedKeeperFee_ = amount.min(UFixed18.wrap(maxFee * 1e12));
        keeperToken().pull(account, raisedKeeperFee_);
    }
}
