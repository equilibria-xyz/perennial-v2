// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "../interfaces/IMultiInvoker.sol";
import "@equilibria/root/number/types/UFixed6.sol";
import "@equilibria/perennial-v2/contracts/types/Position.sol";

struct TriggerOrderMeta {
    IMultiInvoker.InterfaceFee interfaceFee;
}
using TriggerOrderMetaLib for TriggerOrderMeta global;
struct StoredTriggerOrderMeta {
    /* slot 0 */
    uint40 interfaceFee;// <= 1M USDC
    address interfaceFeeReceiver;
    bool interfaceFeeUnwrap;
    bytes6 __unallocated0__;

    /* slot 1 */
    bytes32 __unallocated1__;
}
struct TriggerOrderMetaStorage { StoredTriggerOrderMeta value; }
using TriggerOrderMetaStorageLib for TriggerOrderMetaStorage global;

/**
 * @title TriggerOrderMetaLib
 * @notice
 */
library TriggerOrderMetaLib { }

library TriggerOrderMetaStorageLib {
    // sig: 0xf3469aa7
    error TriggerOrderMetaStorageInvalidError();

    function read(TriggerOrderMetaStorage storage self) internal view returns (TriggerOrderMeta memory) {
        StoredTriggerOrderMeta memory storedValue = self.value;
        return TriggerOrderMeta(IMultiInvoker.InterfaceFee(
            UFixed6.wrap(uint256(storedValue.interfaceFee)),
            storedValue.interfaceFeeReceiver,
            storedValue.interfaceFeeUnwrap
        ));
    }

    function store(TriggerOrderMetaStorage storage self, TriggerOrderMeta memory newValue) internal {
        if (newValue.interfaceFee.amount.gt(UFixed6.wrap(type(uint40).max))) revert TriggerOrderMetaStorageInvalidError();

        self.value = StoredTriggerOrderMeta(
            uint40(UFixed6.unwrap(newValue.interfaceFee.amount)),
            newValue.interfaceFee.receiver,
            newValue.interfaceFee.unwrap,
            bytes6(0),
            bytes32(0)
        );
    }
}
