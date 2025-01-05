// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import { IMarket } from "@perennial/core/contracts/interfaces/IMarket.sol";
import { RiskParameter } from "@perennial/core/contracts/types/RiskParameter.sol";
import { Ownable } from "@equilibria/root/attribute/Ownable.sol";
import { ICoordinator } from "./interfaces/ICoordinator.sol";

/// @title Compressor
/// @notice General purpose calldata compressor for non-sender-dependent transactions.
contract Compressor is Ownable {
    struct PTR { uint256 loc; }

    enum CacheStrategy {
        None,
        Address,
        ID
    }

    bytes32[] public cache;

    function append(bytes calldata data) external {
        for (uint256 i = 0; i < data.length / 32; i += 32)
            cache.push(abi.decode(data[i:i + 32], (bytes32)));
    }

    fallback(bytes calldata data) external returns (bytes memory) {
        address callTo;
        uint256 callValue;
        bytes memory callData;

        PTR memory ptr;
        while (ptr.loc < data.length) {
            (CacheStrategy strat, uint256 len) = _readHeader(data, ptr);

            if (strat == CacheStrategy.None) {
                callData.push(_readBytes(data, ptr, len));
            } else if (strat == CacheStrategy.Address) {
                addresses.push(address(_readValue(data, ptr, len)));
            } else if (strat == CacheStrategy.ID) {
                ids.push(bytes32(_readValue(data, ptr, len)));
            }
        }
    }

    function _readHeader(bytes calldata data, PTR memory ptr) internal pure returns (CacheStrategy strat, uint256 len) {
        // bitmap
        // 1 - cached
        // 2-5 - cached length (16 max length)
        // 6-8 - length (8 max length)

        uint256 value = uint256(bytes32(data[ptr.loc++]));
        (strat, len) = (CacheStrategy(value & 0xc0), value & 0x3f);
    }

    function _readValue(bytes calldata data, PTR memory ptr, uint256 len) internal pure returns (uint256 value) {
        value = uint256(bytes32(data[ptr.loc:ptr.loc + len]));
        ptr.loc += len;
    }
}
