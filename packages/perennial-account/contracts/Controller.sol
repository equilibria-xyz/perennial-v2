// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Instance } from "@equilibria/root/attribute/Instance.sol";

import { IController } from "./interfaces/IController.sol";
import { IVerifier } from "./interfaces/IVerifier.sol";
import { Account } from "./Account.sol";
import { DeployAccount, DeployAccountLib } from "./types/DeployAccount.sol";

contract Controller is Instance, IController {
    // used for deterministic address creation through create2
    bytes32 constant SALT = keccak256("Perrenial V2 Collateral Account");

    /// @dev Contract used to validate messages were signed by the sender
    IVerifier public verifier;

    /// @notice Initializes the Collateral Account Controller
    /// @param verifier_ Contract used to validate messages were signed by the sender
    function initialize(IVerifier verifier_) external initializer(1) {
        __Instance__initialize();
        verifier = verifier_;
    }

    // TODO: remove
    /// @inheritdoc IController
    function deployAccount() external returns (address accountAddress_) {
        Account account = new Account{salt: SALT}(msg.sender);
        accountAddress_ = address(account);
        emit AccountDeployed(msg.sender, accountAddress_);
    }

    /// @inheritdoc IController
    function deployAccountWithSignature(DeployAccount calldata deployAccount_, bytes calldata signature_) external {
        // Ensure the message was signed by the user creating the collateral account
        address signer = verifier.verifyDeployAccount(deployAccount_, signature_);
        if (signer != deployAccount_.user) revert InvalidSignerError();

        Account account = new Account{salt: SALT}(deployAccount_.user);
        emit AccountDeployed(signer, address(account));
    }

    /// @inheritdoc IController
    function getAccountAddress(address user_) external view returns (address) {
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