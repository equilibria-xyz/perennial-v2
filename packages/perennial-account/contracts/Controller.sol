// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { IController } from "./interfaces/IController.sol";
import { DeployAccount, DeployAccountLib } from "./types/DeployAccount.sol";


contract Controller is IController {

    /// @inheritdoc IController
    function deployAccount() external {

    }

    /// @inheritdoc IController
    function deployAccountWithSignature(DeployAccount calldata deployAccount_, bytes calldata signature_) external {

    }

    /// @inheritdoc IController
    function getAccount(address user_) external returns (address) {

    }
}