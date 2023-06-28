// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "../interfaces/IOracleProvider.sol";

contract ReferenceKeeperOracle is IOracleProvider {
    error ReferenceKeeperOracleOutOfOrderCommitError();

    mapping(uint256 => uint256) public _requested;
    mapping(uint256 => OracleVersion) public _at;
    uint256 private _current;
    uint256 private _latest;

    constructor() {
        request();
    }

    function request() public returns (OracleVersion memory, uint256) {
        if (current() > _requested[_current]) _requested[_current++] = block.timestamp;
        return (latest(), current());
    }

    function commit(uint256 timestamp, Fixed6 price) public {
        if (timestamp <= (_latest == 0 ? 0 : _requested[_latest - 1]) || timestamp > _requested[_latest])
            revert ReferenceKeeperOracleOutOfOrderCommitError();
        if (timestamp == _requested[_latest]) _latest++;
        _at[timestamp] = OracleVersion(timestamp, price, true);
    }

    function latest() public view returns (OracleVersion memory) {
        if (_latest == 0) return OracleVersion(0, Fixed6.wrap(0), false);
        return _at[_requested[_latest - 1]];
    }

    function current() public view returns (uint256) { return block.timestamp; }
    function at(uint256 timestamp) public view returns (OracleVersion memory) { return _at[timestamp]; }
    function next() public view returns (uint256) { return _current == _latest ? 0 : _requested[_latest]; }
}
