/**
 * Stores
 *   Market addresses
 *     Market names
 *     Market symbols
 *   Oracle addresses
 *      Oracle IDs
 *   KeeperOracle addresses (for each factory)
 *     KeeperOracle IDs
 */

// https://github.com/0xsequence/sstore2

pragma solidity ^0.8.0;

import "sstore2/contracts/SSTORE2.sol";
import "@equilibria/root/attribute/Ownable.sol";

contract PerennialMetadata is Ownable {
    address private pointer;

    constructor() {
        __Ownable__initialize();
    }

    function setText(string calldata _metadata) external {
        pointer = SSTORE2.write(bytes(_metadata));
    }

    function getText() external view returns (string memory) {
        return string(SSTORE2.read(pointer));
    }
}
