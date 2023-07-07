// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/UFixed6.sol";
import "./Checkpoint.sol";

/// @dev Account type
struct Account {
    uint256 current;
    uint256 latest;
    UFixed6 shares;
    UFixed6 assets;
    UFixed6 deposit;
    UFixed6 redemption;
}
using AccountLib for Account global;
struct StoredAccount {
    uint32 _current;
    uint32 _latest;
    uint48 _shares;
    uint48 _assets;
    uint48 _deposit;
    uint48 _redemption;
}
struct AccountStorage { StoredAccount value; }
using AccountStorageLib for AccountStorage global;

/**
 * @title AccountLib
 * @notice
 */
library AccountLib {
    function process(
        Account memory self,
        uint256 latestId,
        Checkpoint memory checkpoint,
        UFixed6 deposit,
        UFixed6 redemption
    ) internal pure {
        self.latest = latestId;
        (self.assets, self.shares) = (self.assets.add(checkpoint.toAssets(redemption)), self.shares.add(checkpoint.toShares(deposit)));
        (self.deposit, self.redemption) = (self.deposit.sub(deposit), self.redemption.sub(redemption));
    }

    function update(
        Account memory self,
        uint256 currentId,
        UFixed6 assets,
        UFixed6 shares,
        UFixed6 deposit,
        UFixed6 redemption
    ) internal pure {
        self.current = currentId;
        (self.assets, self.shares) = (self.assets.sub(assets), self.shares.sub(shares));
        (self.deposit, self.redemption) = (self.deposit.add(deposit), self.redemption.add(redemption));
    }
}

library AccountStorageLib {
    error AccountStorageInvalidError();

    function read(AccountStorage storage self) internal view returns (Account memory) {
        StoredAccount memory storedValue = self.value;
        return Account(
            uint256(storedValue._current),
            uint256(storedValue._latest),
            UFixed6.wrap(uint256(storedValue._shares)),
            UFixed6.wrap(uint256(storedValue._assets)),
            UFixed6.wrap(uint256(storedValue._deposit)),
            UFixed6.wrap(uint256(storedValue._redemption))
        );
    }

    function store(AccountStorage storage self, Account memory newValue) internal {
        if (newValue.current > uint256(type(uint32).max)) revert AccountStorageInvalidError();
        if (newValue.latest > uint256(type(uint32).max)) revert AccountStorageInvalidError();
        if (newValue.shares.gt(UFixed6.wrap(type(uint48).max))) revert AccountStorageInvalidError();
        if (newValue.assets.gt(UFixed6.wrap(type(uint48).max))) revert AccountStorageInvalidError();
        if (newValue.deposit.gt(UFixed6.wrap(type(uint48).max))) revert AccountStorageInvalidError();
        if (newValue.redemption.gt(UFixed6.wrap(type(uint48).max))) revert AccountStorageInvalidError();

        self.value = StoredAccount(
            uint32(newValue.current),
            uint32(newValue.latest),
            uint48(UFixed6.unwrap(newValue.shares)),
            uint48(UFixed6.unwrap(newValue.assets)),
            uint48(UFixed6.unwrap(newValue.deposit)),
            uint48(UFixed6.unwrap(newValue.redemption))
        );
    }
}
