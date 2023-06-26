// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "./IFactory.sol";
import "@equilibria/root/control/interfaces/IInitializable.sol";

interface IInstance is IInitializable {
    error InstanceNotOwnerError(address sender);
    error InstancePausedError();

    function factory() external view returns (IFactory);
}
