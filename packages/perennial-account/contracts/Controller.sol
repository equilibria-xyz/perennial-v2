// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Instance } from "@equilibria/root/attribute/Instance.sol";

import { IController } from "./interfaces/IController.sol";
import { IVerifier } from "./interfaces/IVerifier.sol";
import { Account } from "./Account.sol";
import { DeployAccount, DeployAccountLib } from "./types/DeployAccount.sol";
import { UpdateSigner, UpdateSignerLib } from "./types/UpdateSigner.sol";

import "hardhat/console.sol";

contract Controller is Instance, IController {
    // used for deterministic address creation through create2
    bytes32 constant SALT = keccak256("Perrenial V2 Collateral Account");

    /// @dev Contract used to validate messages were signed by the sender
    IVerifier public verifier;

    /// @dev Mapping of collateral accounts back to their owners
    /// collateral account => owner
    mapping(address => address) public owners;

    /// @dev Mapping of allowed signers for each collateral account
    /// collateral account => delegate => enabled flag
    mapping(address => mapping(address => bool)) public signers;

    /// @notice Initializes the Collateral Account Controller
    /// @param verifier_ Contract used to validate messages were signed by the sender
    function initialize(IVerifier verifier_) external initializer(1) {
        __Instance__initialize();
        verifier = verifier_;
    }

    /// @inheritdoc IController
    function getAccountAddress(address user_) external view returns (address) {
        return _getAccountAddress(user_);
    }

    // TODO: consider creating modifiers for signedBySender and signedByDelegate, 
    // maybe even for drawing keeper fee from the account

    // TODO: remove; Kevin wants this to be message-only
    /// @inheritdoc IController
    function deployAccount() external returns (address accountAddress_) {
        Account account = new Account{salt: SALT}(msg.sender);
        accountAddress_ = address(account);
        owners[accountAddress_] = msg.sender;
        emit AccountDeployed(msg.sender, accountAddress_);
    }

    /// @inheritdoc IController
    function deployAccountWithSignature(DeployAccount calldata deployAccount_, bytes calldata signature_) external {
        // Ensure the message was signed by the user creating the collateral account
        address signer = verifier.verifyDeployAccount(deployAccount_, signature_);
        if (signer != deployAccount_.action.common.account) revert InvalidSignerError();

        Account account = new Account{salt: SALT}(signer);
        owners[address(account)] = signer;
        // TODO: draw fee from newly created contract
        emit AccountDeployed(signer, address(account));
    }

    /// @inheritdoc IController
    function updateSigner(address signer_, bool newEnabled_) external {
        address account = _getAccountAddress(msg.sender);
        signers[account][signer_] = newEnabled_;
        emit SignerUpdated(account, signer_, newEnabled_);
    }

    /// @inheritdoc IController
    function updateSignerWithSignature(
        UpdateSigner calldata updateSigner_, 
        bytes calldata signature_
    ) external {
        // Ensure the message was signed only by the owner, not an existing delegate
        address signer = verifier.verifyUpdateSigner(updateSigner_, signature_);
        address account = updateSigner_.action.common.account;
        if (signer != owners[account]) revert InvalidSignerError();

        signers[account][updateSigner_.delegate] = updateSigner_.newEnabled;
        emit SignerUpdated(account, updateSigner_.delegate, updateSigner_.newEnabled);
    }

    /// @dev calculates the create2 deterministic address of a user's collateral account
    /// @param user_ EOA of the user owning a collateral account
    function _getAccountAddress(address user_) private view returns (address) {
        // generate bytecode for an account created for the specified owner
        bytes memory bytecode = abi.encodePacked(type(Account).creationCode, abi.encode(user_));
        // calculate the hash for that bytecode
        bytes32 hash = keccak256(
            abi.encodePacked(bytes1(0xff), address(this), SALT, keccak256(bytecode))
        );
        // cast last 20 bytes of hash to address
        return address(uint160(uint256(hash)));
    }
}
