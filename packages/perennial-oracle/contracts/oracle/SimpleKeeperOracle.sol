// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "../IOracleProvider.sol";

contract SimpleKeeperOracle is IOracleProvider {
    error SimpleKeeperOracleOutOfOrderCommitError();

    mapping(uint256 => uint256) public _versions;
    mapping(uint256 => OracleVersion) public _at;
    uint256 private _current;
    uint256 private _latest;

    function sync() external returns (OracleVersion memory, uint256) {
        if (current() > _versions[_current]) {
            _current++;
            _versions[_current] = current();
        }

        return (latest(), current());
    }
    function latest() public view returns (OracleVersion memory) { return _at[_versions[_latest]]; }
    function current() public view returns (uint256) { return block.timestamp; }
    function at(uint256 version) public view returns (OracleVersion memory) { return _at[version]; }

    function commit(uint256 version, Fixed6 price) external {
        if (version != _versions[_latest]) revert SimpleKeeperOracleOutOfOrderCommitError();
        _at[version] = OracleVersion(version, version, price, true);
        _latest++;
    }
}
