// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/storage/UStorage.sol";
import "@equilibria/root/control/unstructured/UInitializable.sol";
import "@equilibria/root/control/unstructured/UOwnable.sol";
import "./IPausable.sol";

/**
 * @title UPausable
 * @notice
 * @dev
 */
abstract contract UPausable is IPausable, UOwnable {
    /// @dev The pauser address
    AddressStorage private constant _pauser = AddressStorage.wrap(keccak256("equilibria.root.UPausable.pauser"));
    function pauser() public view returns (address) { return _pauser.read(); }

    /// @dev The pending owner address
    BoolStorage private constant _paused = BoolStorage.wrap(keccak256("equilibria.root.UPausable.paused"));
    function paused() public view returns (bool) { return _paused.read(); }

    function updatePauser(address newPauser) public onlyOwner {
        _pauser.store(newPauser);
        emit PauserUpdated(newPauser);
    }

    function pause() external onlyPauser {
        _paused.store(true);
        emit Paused();
    }

    function unpause() external onlyPauser {
        _paused.store(false);
        emit Unpaused();
    }

    /// @dev Throws if called by any account other than the pauser
    modifier onlyPauser {
        if (_sender() != pauser() && _sender() != owner()) revert UPausableNotPauserError(_sender());
        _;
    }
}
