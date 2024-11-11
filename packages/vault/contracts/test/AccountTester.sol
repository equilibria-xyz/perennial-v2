// // SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { UFixed6 } from "@equilibria/root/number/types/UFixed6.sol";
import { Account, AccountStorage } from "../types/Account.sol";
import { Checkpoint } from "../types/Checkpoint.sol";

contract AccountTester {
    AccountStorage public account;

    function store(Account memory newAccount) external {
        account.store(newAccount);
    }

    function read() external view returns (Account memory) {
        return account.read();
    }

    function processGlobal(
        uint256 latestId,
        Checkpoint memory checkpoint,
        UFixed6 deposit,
        UFixed6 redemption
    ) external {
        Account memory newAccount = account.read();

        newAccount.processGlobal(latestId, checkpoint, deposit, redemption);

        account.store(newAccount);
    }

    function processLocal(
        uint256 latestId,
        Checkpoint memory checkpoint,
        UFixed6 deposit,
        UFixed6 redemption
    ) external {
        Account memory newAccount = account.read();

        newAccount.processLocal(latestId, checkpoint, deposit, redemption);

        account.store(newAccount);
    }

    function update(uint256 currentId, UFixed6 assets, UFixed6 shares, UFixed6 deposit, UFixed6 redemption) external {
        Account memory newAccount = account.read();

        newAccount.update(currentId, assets, shares, deposit, redemption);

        account.store(newAccount);
    }
}
