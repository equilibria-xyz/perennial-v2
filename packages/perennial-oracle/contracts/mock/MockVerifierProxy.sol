// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "./MockFeeManager.sol";

contract MockVerifierProxy {
    MockFeeManager public immutable mockFeeManager;

    constructor(MockFeeManager mockFeeManager_) {
        mockFeeManager = mockFeeManager_;
    }

    /// @dev Only does validation on the value sent
    function verify(bytes calldata payload, bytes calldata parameterPayload) external payable returns (bytes memory) {
        (address quote) = abi.decode(parameterPayload, (address));
        if (quote != mockFeeManager.nativeAddress()) revert("MockVerifierProxy: incorrect quote token");
        (, bytes memory report, , , ) = abi.decode(payload, (bytes32[3], bytes, bytes32[], bytes32[], bytes32));
        (, , , uint256 nativeQuantity, , ,) = abi.decode(
            report,
            (bytes32, uint32, uint32, uint192, uint192, uint32, uint192)
        );
        if (msg.value != nativeQuantity) revert("MockVerifierProxy: incorrect value");
        return report;
    }
}
