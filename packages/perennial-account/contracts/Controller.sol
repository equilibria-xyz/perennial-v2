// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import { Instance } from "@equilibria/root/attribute/Instance.sol";

import { IAccount, IMarket } from "./interfaces/IAccount.sol";
import { IController } from "./interfaces/IController.sol";
import { IVerifier } from "./interfaces/IVerifier.sol";
import { Account } from "./Account.sol";
import { Action } from "./types/Action.sol";
import { DeployAccount, DeployAccountLib } from "./types/DeployAccount.sol";
import { MarketTransfer, MarketTransferLib } from "./types/MarketTransfer.sol";
import { SignerUpdate, SignerUpdateLib } from "./types/SignerUpdate.sol";
import { Withdrawal, WithdrawalLib } from "./types/Withdrawal.sol";

/// @title Controller
/// @notice Facilitates unpermissioned actions between collateral accounts and markets
contract Controller is Instance, IController {
    // used for deterministic address creation through create2
    bytes32 constant SALT = keccak256("Perennial V2 Collateral Accounts");

    /// @dev Contract used to validate messages were signed by the sender
    IVerifier public verifier;

    // TODO: consider mapping owner address rather than collateral account address
    /// @dev Mapping of allowed signers for each collateral account
    /// collateral account => delegate => enabled flag
    mapping(address => mapping(address => bool)) public signers;

    /// @notice Configures the EIP-712 message verifier used by this controller
    /// @param verifier_ Contract used to validate messages were signed by the sender
    function initialize(IVerifier verifier_) external initializer(1) {
        __Instance__initialize();
        verifier = verifier_;
    }

    /// @inheritdoc IController
    function getAccountAddress(address user) public view returns (address) {
        // generate bytecode for an account created for the specified owner
        bytes memory bytecode = abi.encodePacked(
            type(Account).creationCode, abi.encode(user), abi.encode(address(this)));
        // calculate the hash for that bytecode
        bytes32 hash = keccak256(
            abi.encodePacked(bytes1(0xff), address(this), SALT, keccak256(bytecode))
        );
        // cast last 20 bytes of hash to address
        return address(uint160(uint256(hash)));
    }

    /// @inheritdoc IController
    function deployAccount() public returns (IAccount) {
        return _createAccount(msg.sender);
    }

    /// @inheritdoc IController
    function deployAccountWithSignature(
        DeployAccount calldata deployAccount_, 
        bytes calldata signature
    ) virtual external {
        _deployAccountWithSignature(deployAccount_, signature);
    }

    function _deployAccountWithSignature(
        DeployAccount calldata deployAccount_, 
        bytes calldata signature
    ) internal returns (IAccount account)
    {
        // create the account
        address owner = deployAccount_.action.common.account;
        account = _createAccount(owner);

        // check signer after account creation to avoid cost of recalculating address
        address signer = verifier.verifyDeployAccount(deployAccount_, signature);
        if (signer != owner && !signers[address(account)][signer]) revert InvalidSignerError();
    }

    function _createAccount(address owner) internal returns (IAccount account) {
        account = new Account{salt: SALT}(owner, address(this));
        emit AccountDeployed(owner, account);
    }

    /// @inheritdoc IController
    function updateSigner(address signer, bool newEnabled) public {
        address account = getAccountAddress(msg.sender);
        signers[account][signer] = newEnabled;
        emit SignerUpdated(account, signer, newEnabled);
    }

    /// @inheritdoc IController
    function updateSignerWithSignature(
        SignerUpdate calldata signerUpdate, 
        bytes calldata signature
    ) virtual external {
        _updateSignerWithSignature(signerUpdate, signature);
    }

    function _updateSignerWithSignature(SignerUpdate calldata signerUpdate,  bytes calldata signature) internal {
        // ensure the message was signed only by the owner, not an existing delegate
        address messageSigner = verifier.verifySignerUpdate(signerUpdate, signature);
        address owner = signerUpdate.action.common.account;
        address account = getAccountAddress(owner);
        if (messageSigner != owner) revert InvalidSignerError();

        signers[account][signerUpdate.signer] = signerUpdate.approved;
        emit SignerUpdated(account, signerUpdate.signer, signerUpdate.approved);
    }

    /// @inheritdoc IController
    function marketTransferWithSignature(MarketTransfer calldata marketTransfer, bytes calldata signature) virtual external {
        IAccount account = _verifyMarketTransfer(marketTransfer, signature);
        IMarket market = IMarket(marketTransfer.market);
        account.marketTransfer(market, marketTransfer.amount);
    }

    function _verifyMarketTransfer(
        MarketTransfer calldata marketTransfer, 
        bytes calldata signature
    ) internal returns (IAccount account_) {
        // ensure the message was signed by the owner or a delegated signer
        address signer = verifier.verifyMarketTransfer(marketTransfer, signature);
        account_ = IAccount(_validateMessage(marketTransfer.action, signer));        
    }

    /// @inheritdoc IController
    function withdrawWithSignature(Withdrawal calldata withdrawal, bytes calldata signature) virtual external {
        _withdrawWithSignature(withdrawal, signature);
    }

    function _withdrawWithSignature(Withdrawal calldata withdrawal, bytes calldata signature) internal {
        // ensure the message was signed by the owner or a delegated signer
        address signer = verifier.verifyWithdrawal(withdrawal, signature);
        IAccount account = IAccount(_validateMessage(withdrawal.action, signer));

        // call the account's implementation to push to owner
        account.withdraw(withdrawal.token, withdrawal.amount);
    }

    /// @dev calculates the account address and reverts if it does not match the account in the message, 
    /// or if user is unauthorized to sign transactions for the owner
    /// @param action Action struct from the message, indicating the account and owner addresses
    /// @param signer Verified EIP-712 signature of the message, which should be from owner or a delegate
    function _validateMessage(Action calldata action, address signer) private view returns (address accountAddress) {
        accountAddress = getAccountAddress(action.common.account);
        if (accountAddress != action.account) revert WrongAccountError();
        if (signer != action.common.account && !signers[accountAddress][signer]) revert InvalidSignerError();
    }
}
