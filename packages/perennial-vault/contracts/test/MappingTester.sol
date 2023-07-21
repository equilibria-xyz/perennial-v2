// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "../types/Mapping.sol";

contract MappingTester {
    MappingStorage private _mapping;

    function store(Mapping memory newMapping) external {
        _mapping.store(newMapping);
    }

    function read() external view returns (Mapping memory) {
        return _mapping.read();
    }

    function initialize(uint256 initialLength) external {
        Mapping memory newMapping = _mapping.read();

        newMapping.initialize(initialLength);

        _mapping.store(newMapping);
    }

    function update(uint256 index, uint256 id) external view returns (Mapping memory) {
        Mapping memory newMapping = _mapping.read();

        newMapping.update(index, id);

        return newMapping;
    }

    function length() external view returns (uint256) {
        return _mapping.read().length();
    }

    function get(uint256 index) external view returns (uint256) {
        return _mapping.read().get(index);
    }

    function ready(Mapping memory latest) external view returns (bool) {
        return _mapping.read().ready(latest);
    }

    function next(Mapping memory currentMapping) external view returns (bool) {
        return _mapping.read().next(currentMapping);
    }
}
