// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "../interfaces/IChainlinkFactory.sol";

contract MockFeeManager {
    address public immutable nativeAddress;

    constructor(address nativeAddress_) {
        nativeAddress = nativeAddress_;
    }

    function getFeeAndReward(
        address,
        bytes memory report,
        address quoteAddress
    ) external view returns (Asset memory, Asset memory, uint256) {
        if (quoteAddress != nativeAddress) revert("MockFeeManager: incorrect quote token");
        (, , , uint256 nativeQuantity, , ,) = abi.decode(
            report,
            (bytes32, uint32, uint32, uint192, uint192, uint32, uint192)
        );
        Asset memory reward;
        return (Asset(nativeAddress, nativeQuantity), reward, 0);
  }
}
