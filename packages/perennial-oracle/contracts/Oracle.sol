// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "@equilibria/root/control/unstructured/UOwnable.sol";
import "./interfaces/IOracle.sol";
import "@equilibria/root-v2/contracts/UInstance.sol";

contract Oracle is IOracle, UInstance, UOwnable {
    error OracleOutOfOrderCommitError();

    event OracleUpdated(IOracleProvider newProvider);

    struct Checkpoint { // TODO: naming
        IOracleProvider provider;
        uint96 timestamp; /// @dev The last timestamp that this oracle provider is valid
    }

    struct Global {
        uint128 current;
        uint128 latest;
    }

    mapping(uint256 => Checkpoint) public oracles;
    Global public global;

    function initialize(IOracleProvider initialProvider) external initializer(1) {
        __UOwnable__initialize();
        __UInstance__initialize();

        _updateCurrent(initialProvider);
        sync();
    }

    function update(IOracleProvider newProvider) external onlyOwner {
        _updateCurrent(newProvider);
        sync();
    }

    function sync() public returns (OracleVersion memory latestVersion, uint256 currentTimestamp) {
        (latestVersion, currentTimestamp) = oracles[uint256(global.current)].provider.sync();
        oracles[uint256(global.current)].timestamp = uint96(currentTimestamp);

        if (uint256(global.current) == uint256(global.latest)) {
            return (latestVersion, currentTimestamp);
        } else {
            _updateLatest(latestVersion);
            return (latest(), currentTimestamp);
        }
    }

    function latest() public view returns (OracleVersion memory latestVersion) {
        latestVersion = oracles[uint256(global.latest)].provider.latest();
        if (latestVersion.timestamp > uint256(oracles[uint256(global.latest)].timestamp))
            return at(uint256(oracles[uint256(global.latest)].timestamp));
    }

    function current() public view returns (uint256) {
        return oracles[uint256(global.current)].provider.current();
    }

    function at(uint256 timestamp) public view returns (OracleVersion memory atVersion) {
        if (timestamp == 0) return atVersion;

        IOracleProvider provider;
        for (uint256 i = uint256(global.current); i > 0; i--) {
            if (timestamp > uint256(oracles[i].timestamp)) break;
            provider = oracles[i].provider;
        }
        return provider.at(timestamp);
    }

    function _updateCurrent(IOracleProvider newProvider) private {
        oracles[uint256(++global.current)] = Checkpoint(newProvider, 0);
        emit OracleUpdated(newProvider);
    }

    function _updateLatest(OracleVersion memory currentOracleLatestVersion) private {
        uint256 latestTimestamp = uint256(global.latest) == 0 ? 0 : oracles[uint256(global.latest)].provider.latest().timestamp;
        if (uint256(oracles[uint256(global.latest)].timestamp) > latestTimestamp) return;
        if (uint256(oracles[uint256(global.latest)].timestamp) >= currentOracleLatestVersion.timestamp) return;
        global.latest++;
    }
}
