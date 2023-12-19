// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "./IMultiInvoker.sol";
import "../types/packedBytes/PackedCalldataLib.sol";
import { PackedFixedLib } from "../types/packedBytes/rootNumber/PackedFixedLib.sol";
import { PackedUFixedLib } from "../types/packedBytes/rootNumber/PackedUFixedLib.sol";

interface IMultiInvokerRollup is IMultiInvoker {

    event AddressAddedToCache(address indexed value, uint256 index);

    error MultiInvokerRollupAddressIndexOutOfBoundsError();
    error MultiInvokerRollupInvalidUint256LengthError();
    error MultiInvokerRollupInvalidInt256LengthError();
    error MultiInvokerRollupMissingMagicByteError();

    function addressCache(uint256 index) external view returns(address);
    function addressLookup(address value) external view returns(uint256 index);
}
