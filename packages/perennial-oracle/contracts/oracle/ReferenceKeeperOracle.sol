// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "../IOracleProvider.sol";

contract ReferenceKeeperOracle is IOracleProvider {
    error ReferenceKeeperOracleOutOfOrderCommitError();

    mapping(uint256 => uint256) public _requested;
    mapping(uint256 => OracleVersion) public _at;
    uint256 private _current;
    uint256 private _latest;

    function sync() external returns (OracleVersion memory) {
        if (block.timestamp > _requested[_current]) _requested[_current++] = block.timestamp;
        return latest();
    }
    function latest() public view returns (OracleVersion memory) {
        if (_latest == 0) return OracleVersion(0, Fixed6Lib.ZERO, false);
        return _at[_requested[_latest - 1]];
    }
    function at(uint256 timestamp) public view returns (OracleVersion memory) { return _at[timestamp]; }

    function next() external view returns (uint256) { return _requested[_latest]; }
    function commit(uint256 timestamp, Fixed6 price) external {
        if (timestamp != _requested[_latest++]) revert ReferenceKeeperOracleOutOfOrderCommitError();
        _at[timestamp] = OracleVersion(timestamp, price, true);
    }
}
