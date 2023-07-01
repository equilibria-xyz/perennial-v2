// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "@equilibria/root-v2/contracts/Instance.sol";
import "./interfaces/IOracle.sol";
import "./interfaces/IOracleProviderFactory.sol";

contract Oracle is IOracle, Instance {
    mapping(uint256 => Checkpoint) public oracles;
    Global public global;

    function initialize(IOracleProvider initialProvider) external initializer(1) {
        __Instance__initialize();
        _updateCurrent(initialProvider);
        _updateLatest(initialProvider.latest());
    }

    function update(IOracleProvider newProvider) external onlyOwner {
        _updateCurrent(newProvider);
        _updateLatest(newProvider.latest());
    }

    function request() external onlyAuthorized returns (OracleVersion memory latestVersion, uint256 currentTimestamp) {
        (latestVersion, currentTimestamp) = oracles[uint256(global.current)].provider.request();
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
        oracles[uint256(++global.current)] = Checkpoint(newProvider, uint96(newProvider.current()));
        emit OracleUpdated(newProvider);
    }

    function _updateLatest(OracleVersion memory currentOracleLatestVersion) private {
        uint256 latestTimestamp = uint256(global.latest) == 0 ? 0 : oracles[uint256(global.latest)].provider.latest().timestamp;
        if (uint256(oracles[uint256(global.latest)].timestamp) > latestTimestamp) return;
        if (uint256(oracles[uint256(global.latest)].timestamp) >= currentOracleLatestVersion.timestamp) return;
        global.latest++;
    }

    modifier onlyAuthorized {
        if (!IOracleProviderFactory(address(factory())).authorized(msg.sender)) {
            revert OracleProviderUnauthorizedError();
        }
        _;
    }
}
