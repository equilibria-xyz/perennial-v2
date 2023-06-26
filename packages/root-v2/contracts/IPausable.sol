// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/control/interfaces/IOwnable.sol";

interface IPausable is IOwnable {
    event PauserUpdated(address indexed newPauser);
    event Paused();
    event Unpaused();

    error UPausableNotPauserError(address sender);

    function pauser() external view returns (address);
    function paused() external view returns (bool);
    function updatePauser(address newPauser) external;
    function pause() external;
    function unpause() external;
}
