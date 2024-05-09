// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Instance } from "@equilibria/root/attribute/Instance.sol";

import { IAccount } from "./interfaces/IAccount.sol";
import { IController } from "./interfaces/IController.sol";
import { IVerifier } from "./interfaces/IVerifier.sol";
import { Account } from "./Account.sol";
import { DeployAccount, DeployAccountLib } from "./types/DeployAccount.sol";
import { SignerUpdate, SignerUpdateLib } from "./types/SignerUpdate.sol";
import { Withdrawal, WithdrawalLib } from "./types/Withdrawal.sol";

contract Controller is Instance, IController {
    // used for deterministic address creation through create2
    bytes32 constant SALT = keccak256("Perrenial V2 Collateral Account");

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
    function getAccountAddress(address user_) external view returns (address) {
        return _getAccountAddress(user_);
    }

    // TODO: remove; Kevin wants this to be message-only
    /// @inheritdoc IController
    function deployAccount() external returns (address accountAddress_) {
        Account account = new Account{salt: SALT}(msg.sender, address(this));
        accountAddress_ = address(account);
        emit AccountDeployed(msg.sender, accountAddress_);
    }

    /// @inheritdoc IController
    function deployAccountWithSignature(
        DeployAccount calldata deployAccount_, 
        bytes calldata signature_
    ) virtual external {
        _deployAccountWithSignature(deployAccount_, signature_);
    }

    function _deployAccountWithSignature(
        DeployAccount calldata deployAccount_, 
        bytes calldata signature_
    ) internal returns (Account _account)
    {
        // create the account
        address owner = deployAccount_.action.common.account;
        _account = new Account{salt: SALT}(owner, address(this));

        // check signer after account creation to avoid cost of recalculating address
        address signer = verifier.verifyDeployAccount(deployAccount_, signature_);
        if (signer != owner && !signers[address(_account)][signer]) revert InvalidSignerError();

        emit AccountDeployed(owner, address(_account));
    }

    /// @inheritdoc IController
    function updateSigner(address signer_, bool newEnabled_) external {
        address account = _getAccountAddress(msg.sender);
        signers[account][signer_] = newEnabled_;
        emit SignerUpdated(account, signer_, newEnabled_);
    }

    /// @inheritdoc IController
    function updateSignerWithSignature(
        SignerUpdate calldata signerUpdate_, 
        bytes calldata signature_
    ) virtual external {
        _updateSignerWithSignature(signerUpdate_, signature_);
    }

    function _updateSignerWithSignature(SignerUpdate calldata signerUpdate_,  bytes calldata signature_) internal {
        // ensure the message was signed only by the owner, not an existing delegate
        address messageSigner = verifier.verifySignerUpdate(signerUpdate_, signature_);
        address owner = signerUpdate_.action.common.account;
        address account = _getAccountAddress(owner);
        if (messageSigner != owner) revert InvalidSignerError();

        signers[account][signerUpdate_.signer] = signerUpdate_.approved;
        emit SignerUpdated(account, signerUpdate_.signer, signerUpdate_.approved);
    }

    /// @inheritdoc IController
    function withdrawWithSignature(Withdrawal calldata withdrawal_, bytes calldata signature_) virtual external {
        _withdrawWithSignature(withdrawal_, signature_);
    }

    function _withdrawWithSignature(Withdrawal calldata withdrawal_, bytes calldata signature_) internal {
        // ensure the message was signed by the owner or a delegated signer
        address signer = verifier.verifyWithdrawal(withdrawal_, signature_);
        IAccount account = IAccount(_ensureValidSigner(withdrawal_.action.common.account, signer));

        // call the account's implementation to push to owner
        account.withdraw(withdrawal_.token, withdrawal_.amount);
    }

    /// @dev calculates the account address and reverts if user is not authorized to sign transactions for the owner
    function _ensureValidSigner(address owner_, address signer_) private view returns (address accountAddress_) {
        accountAddress_ = _getAccountAddress(owner_);
        if (signer_ != owner_ && !signers[accountAddress_][signer_]) revert InvalidSignerError();
    }

    /// @dev calculates the create2 deterministic address of a user's collateral account
    /// @param user_ EOA of the user owning a collateral account
    function _getAccountAddress(address user_) private view returns (address) {
        // generate bytecode for an account created for the specified owner
        bytes memory bytecode = abi.encodePacked(
            type(Account).creationCode, abi.encode(user_), abi.encode(address(this)));
        // calculate the hash for that bytecode
        bytes32 hash = keccak256(
            abi.encodePacked(bytes1(0xff), address(this), SALT, keccak256(bytecode))
        );
        // cast last 20 bytes of hash to address
        return address(uint160(uint256(hash)));
    }
}
