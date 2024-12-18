// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { MockFeeManager } from "./MockFeeManager.sol";

contract MockVerifierProxy {
    MockFeeManager public immutable mockFeeManager;

    constructor(MockFeeManager mockFeeManager_) {
        mockFeeManager = mockFeeManager_;
    }

    /// @dev Only does validation on the value sent
    function verifyBulk(bytes[] calldata payloads, bytes calldata parameterPayload) external payable returns (bytes[] memory) {
        (address quote) = abi.decode(parameterPayload, (address));
        if (quote != mockFeeManager.nativeAddress()) revert("MockVerifierProxy: incorrect quote token");
        bytes[] memory reports = new bytes[](payloads.length);
        uint256 totalValue = 0;
        for (uint256 i = 0; i < payloads.length; i++) {
            bytes memory payload = payloads[i];
            (, bytes memory report, , , ) = abi.decode(payload, (bytes32[3], bytes, bytes32[], bytes32[], bytes32));
            (, , , uint256 nativeQuantity, , ,) = abi.decode(
                report,
                (bytes32, uint32, uint32, uint192, uint192, uint32, uint192)
            );
            totalValue += nativeQuantity;
            reports[i] = report;
        }
        if (msg.value != totalValue) revert("MockVerifierProxy: incorrect value");
        return reports;
    }
}
