// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import { UFixed6 } from "@equilibria/root/number/types/UFixed6.sol";
import { UFixed18Lib } from "@equilibria/root/number/types/UFixed18.sol";
import { Token18 } from "@equilibria/root/token/types/Token18.sol";
import { Instance } from "@equilibria/root/attribute/Instance.sol";
import { IOracleProvider} from "@perennial/v2-core/contracts/interfaces/IOracleProvider.sol";
import { IMarket } from "@perennial/v2-core/contracts/interfaces/IMarket.sol";
import { OracleVersion } from "@perennial/v2-core/contracts/types/OracleVersion.sol";
import { OracleReceipt } from "@perennial/v2-core/contracts/types/OracleReceipt.sol";
import { IOracle } from "./interfaces/IOracle.sol";

/// @title Oracle
/// @notice The top-level oracle contract that implements an oracle provider interface.
/// @dev Manages swapping between different underlying oracle provider interfaces over time.
contract Oracle is IOracle, Instance {
    /// @notice A historical mapping of underlying oracle providers
    mapping(uint256 => Epoch) public oracles;

    /// @notice The global state of the oracle
    OracleGlobal private _global;

    /// @notice The market associated with this oracle
    IMarket public market;

    /// @notice The beneficiary of the oracle fee
    address public beneficiary;

    /// @notice The name of the oracle
    string public name;

    /// @notice Initializes the contract state
    /// @param initialProvider The initial oracle provider
    /// @param name_ The name of the oracle
    function initialize(IOracleProvider initialProvider, string calldata name_) external initializer(1) {
        __Instance__initialize();
        _updateCurrent(initialProvider);
        _updateLatest(initialProvider.latest());
        name = name_;
    }

    /// @notice Updates the current oracle provider
    /// @dev Both the current and new oracle provider must have the same current
    /// @param newProvider The new oracle provider
    function update(IOracleProvider newProvider) external onlyFactory {
        _updateCurrent(newProvider);
        _updateLatest(newProvider.latest());
    }

    /// @notice Returns the global state of the oracle
    /// @return Returns current and latest epoch of the oracle
    function global() external view returns (OracleGlobal memory) {
        return _global;
    }

    /// @notice Registers the market associated with this oracle
    /// @param newMarket The market to register
    function register(IMarket newMarket) external onlyOwner {
        market = newMarket;
        emit MarketUpdated(newMarket);
    }

    /// @notice Updates the beneficiary of the oracle fee
    /// @param newBeneficiary The new beneficiary
    function updateBeneficiary(address newBeneficiary) external onlyOwner {
        beneficiary = newBeneficiary;
        emit BeneficiaryUpdated(newBeneficiary);
    }

    /// @notice Requests a new version at the current timestamp
    /// @param account Original sender to optionally use for callbacks
    function request(IMarket, address account) external onlyMarket {
        (OracleVersion memory latestVersion, uint256 currentTimestamp) = oracles[_global.current].provider.status();

        oracles[
            (currentTimestamp > oracles[_global.latest].timestamp) ? _global.current : _global.latest
        ].provider.request(market, account);

        oracles[_global.current].timestamp = uint96(currentTimestamp);
        _updateLatest(latestVersion);
    }

    /// @notice Returns the latest committed version as well as the current timestamp
    /// @return latestVersion The latest committed version
    /// @return currentTimestamp The current timestamp
    function status() external view returns (OracleVersion memory latestVersion, uint256 currentTimestamp) {
        (latestVersion, currentTimestamp) = oracles[_global.current].provider.status();
        latestVersion = _handleLatest(latestVersion);
    }

    /// @notice Returns the latest committed version
    function latest() public view returns (OracleVersion memory) {
        return _handleLatest(oracles[_global.current].provider.latest());
    }

    /// @notice Returns the current value
    function current() public view returns (uint256) {
        return oracles[_global.current].provider.current();
    }

    /// @notice Returns the oracle version at a given timestamp
    /// @param timestamp The timestamp to query
    /// @return atVersion The oracle version at the given timestamp
    /// @return atReceipt The oracle receipt at the given timestamp
    function at(uint256 timestamp) public view returns (OracleVersion memory atVersion, OracleReceipt memory atReceipt) {
        if (timestamp == 0) return (atVersion, atReceipt);

        IOracleProvider provider = oracles[_global.current].provider;
        for (uint256 i = _global.current - 1; i > 0; i--) {
            if (timestamp > uint256(oracles[i].timestamp)) break;
            provider = oracles[i].provider;
        }

        (atVersion, atReceipt) = provider.at(timestamp);
    }

    /// @notice Withdraws the accrued oracle fees to the beneficiary
    /// @param token The token to withdraw
    function withdraw(Token18 token) external onlyBeneficiary {
        token.push(beneficiary);
    }

    /// @notice Claims an amount of incentive tokens, to be paid out as a fee to the keeper
    /// @dev Will claim all outstanding oracle fees in the underlying market and leave unrequested fees for the beneficiary.
    ///      Can only be called by a registered underlying oracle provider factory.
    /// @param settlementFeeRequested The fixed settmentment fee requested by the oracle
    function claimFee(UFixed6 settlementFeeRequested) external onlySubOracle {
        // claim the fee from the market
        UFixed6 feeReceived = market.claimFee(address(this));

        // return the settlement fee portion to the sub oracle's factory
        market.token().push(msg.sender, UFixed18Lib.from(settlementFeeRequested));

        emit FeeReceived(settlementFeeRequested, feeReceived.sub(settlementFeeRequested));
    }

    /// @notice Handles update the oracle to the new provider
    /// @param newProvider The new oracle provider
    function _updateCurrent(IOracleProvider newProvider) private {
        // oracle must not already be updating
        if (_global.current != _global.latest) revert OracleOutOfSyncError();

        // if the latest version of the underlying oracle is further ahead than its latest request update its timestamp
        if (_global.current != 0) {
            OracleVersion memory latestVersion = oracles[_global.current].provider.latest();
            if (latestVersion.timestamp > oracles[_global.current].timestamp)
                oracles[_global.current].timestamp = uint96(latestVersion.timestamp);
        }

        // add the new oracle registration
        oracles[++_global.current] = Epoch(newProvider, uint96(newProvider.current()));
        emit OracleUpdated(newProvider);
    }

    /// @notice Handles updating the latest oracle to the current if it is ready
    /// @param currentOracleLatestVersion The latest version from the current oracle
    function _updateLatest(OracleVersion memory currentOracleLatestVersion) private {
        if (_latestStale(currentOracleLatestVersion)) _global.latest = _global.current;
    }

    /// @notice Handles overriding the latest version
    /// @dev Applicable if we haven't yet switched over to the current oracle from the latest oracle
    /// @param currentOracleLatestVersion The latest version from the current oracle
    /// @return latestVersion The latest version
    function _handleLatest(
        OracleVersion memory currentOracleLatestVersion
    ) private view returns (OracleVersion memory latestVersion) {
        if (_global.current == _global.latest) return currentOracleLatestVersion;

        bool isLatestStale = _latestStale(currentOracleLatestVersion);
        latestVersion = isLatestStale ? currentOracleLatestVersion : oracles[_global.latest].provider.latest();

        uint256 latestOracleTimestamp =
            uint256(isLatestStale ? oracles[_global.current].timestamp : oracles[_global.latest].timestamp);
        if (!isLatestStale && latestVersion.timestamp > latestOracleTimestamp)
            (latestVersion, ) = at(latestOracleTimestamp);
    }

    /// @notice Returns whether the latest oracle is ready to be updated
    /// @param currentOracleLatestVersion The latest version from the current oracle
    /// @return Whether the latest oracle is ready to be updated
    function _latestStale(OracleVersion memory currentOracleLatestVersion) private view returns (bool) {
        if (_global.current == _global.latest) return false;
        if (_global.latest == 0) return true;

        if (uint256(oracles[_global.latest].timestamp) > oracles[_global.latest].provider.latest().timestamp) return false;
        if (uint256(oracles[_global.latest].timestamp) >= currentOracleLatestVersion.timestamp) return false;

        return true;
    }

    /// @dev Only if the caller is the beneficiary
    modifier onlyBeneficiary {
        if (msg.sender != beneficiary) revert OracleNotBeneficiaryError();
        _;
    }

    /// @dev Only if the caller is the registered market
    modifier onlyMarket {
        if (msg.sender != address(market)) revert OracleNotMarketError();
        _;
    }

    /// @dev Only if the caller is the registered sub oracle
    modifier onlySubOracle {
        if (
            msg.sender != address(oracles[_global.current].provider) &&
            msg.sender != address(oracles[_global.latest].provider)
        ) revert OracleNotSubOracleError();
        _;
    }
}
