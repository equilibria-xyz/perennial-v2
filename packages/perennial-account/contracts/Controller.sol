// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { IController } from "./interfaces/IController.sol";
import { Account } from "./Account.sol";
import { DeployAccount, DeployAccountLib } from "./types/DeployAccount.sol";

contract Controller is IController {
    // used for deterministic address creation through create2
    bytes32 constant SALT = keccak256("Perrenial V2 Collateral Account");

    // TODO: constructor/initializer should take interface for verifier contract

    /// @inheritdoc IController
    function deployAccount() external returns (address accountAddress_) {
        Account account = new Account{salt: SALT}(msg.sender);
        // TODO: emit event with address
        accountAddress_ = address(account);
    }

    /// @inheritdoc IController
    function deployAccountWithSignature(DeployAccount calldata deployAccount_, bytes calldata signature_) external {
        // TODO: call verifier to verify signature
        Account account = new Account{salt: SALT}(deployAccount_.user);
        // TODO: emit event with address
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