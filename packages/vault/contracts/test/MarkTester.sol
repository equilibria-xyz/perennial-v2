// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Mark, MarkStorage } from "../types/Mark.sol";

contract MarkTester {
    MarkStorage public mark;

    function store(Mark memory newMark) external {
        mark.store(newMark);
    }

    function read() external view returns (Mark memory) {
        return mark.read();
    }
}
