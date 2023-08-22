// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/attribute/Ownable.sol";
import "./MultiInvoker.sol";

/// @title MultiInvokerKeeper
/// @notice A contract that forwards invocations to a MultiInvoker, keeping any accrued DSU in this contract
contract MultiInvokerKeeper is Ownable {
    /// @dev The MultiInvoker to forward invocations to
    MultiInvoker public immutable multiInvoker;

    constructor(address multiinvoker_) {
        multiInvoker = MultiInvoker(multiinvoker_);
    }

    function initialize() external initializer(1) {
        __UOwnable__initialize();
    }

    /// @notice Forwards invocations to `multiinvoker`, keeping any accrued DSU in this contract
    /// @param invocations List of actions to execute in order
    function invoke(IMultiInvoker.Invocation[] calldata invocations) external payable {
        multiInvoker.invoke{value: msg.value}(invocations);
    }

    /// @notice Sweeps any accrued DSU to the specified recipient
    function sweepDSU(address recipient) external onlyOwner {
        multiInvoker.DSU().push(recipient, multiInvoker.DSU().balanceOf());
    }
}
