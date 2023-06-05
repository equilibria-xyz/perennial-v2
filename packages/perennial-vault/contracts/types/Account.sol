// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root-v2/contracts/UFixed6.sol";
import "./Checkpoint.sol";

/// @dev Account type
struct Account {
    uint256 latest;
    UFixed6 shares;
    UFixed6 assets;
    UFixed6 deposit;
    UFixed6 redemption;
}
using AccountLib for Account global;
struct StoredAccount {
    uint32 _latest;
    uint56 _shares;
    uint56 _assets;
    uint56 _deposit;
    uint56 _redemption;
}
struct AccountStorage { StoredAccount value; }
using AccountStorageLib for AccountStorage global;

/**
 * @title AccountLib
 * @notice
 */
library AccountLib {
    function process(
        Account memory account,
        Checkpoint memory checkpoint,
        UFixed6 deposit,
        UFixed6 redemption,
        uint256 id
    ) internal view {
        account.shares = account.shares.add(checkpoint.toShares(deposit));
        account.assets = account.assets.add(checkpoint.toAssets(redemption));
        account.deposit = account.deposit.sub(deposit);
        account.redemption = account.redemption.sub(redemption);
        account.latest = id;
    }
}

library AccountStorageLib {
    error AccountStorageInvalidError();

    function read(AccountStorage storage self) internal view returns (Account memory) {
        StoredAccount memory storedValue = self.value;
        return Account(
            uint256(storedValue._latest),
            UFixed6.wrap(uint256(storedValue._shares)),
            UFixed6.wrap(uint256(storedValue._assets)),
            UFixed6.wrap(uint256(storedValue._deposit)),
            UFixed6.wrap(uint256(storedValue._redemption))
        );
    }

    function store(AccountStorage storage self, Account memory newValue) internal {
        if (newValue.latest > type(uint32).max) revert AccountStorageInvalidError();
        if (newValue.shares.gt(UFixed6Lib.MAX_56)) revert AccountStorageInvalidError();
        if (newValue.assets.gt(UFixed6Lib.MAX_56)) revert AccountStorageInvalidError();
        if (newValue.deposit.gt(UFixed6Lib.MAX_56)) revert AccountStorageInvalidError();
        if (newValue.redemption.gt(UFixed6Lib.MAX_56)) revert AccountStorageInvalidError();

        self.value = StoredAccount(
            uint32(newValue.latest),
            uint56(UFixed6.unwrap(newValue.shares)),
            uint56(UFixed6.unwrap(newValue.assets)),
            uint56(UFixed6.unwrap(newValue.deposit)),
            uint56(UFixed6.unwrap(newValue.redemption))
        );
    }
}
