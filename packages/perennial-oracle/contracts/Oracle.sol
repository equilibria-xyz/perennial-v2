// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import "@equilibria/root/attribute/Instance.sol";
import "@equilibria/perennial-v2/contracts/interfaces/IOracleProviderFactory.sol";
import "@equilibria/perennial-v2/contracts/interfaces/IMarket.sol";
import "./interfaces/IOracle.sol";
import "./interfaces/IOracleFactory.sol";

/// @title Oracle
/// @notice The top-level oracle contract that implements an oracle provider interface.
/// @dev Manages swapping between different underlying oracle provider interfaces over time.
contract Oracle is IOracle, Instance {
    /// @notice A historical mapping of underlying oracle providers
    mapping(uint256 => Epoch) public oracles;

    /// @notice The global state of the oracle
    OracleGlobal public global;

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

    /// @notice Updates the name of the oracle
    /// @dev Allows setting the name for previously deployed oracles (v2.3 migration)
    /// @param newName The new oracle name
    function updateName(string calldata newName) external onlyOwner {
        name = newName;
    }

    /// @notice Requests a new version at the current timestamp
    /// @param account Original sender to optionally use for callbacks
    function request(IMarket, address account) external onlyMarket {
        (OracleVersion memory latestVersion, uint256 currentTimestamp) = oracles[global.current].provider.status();

        oracles[
            (currentTimestamp > oracles[global.latest].timestamp) ? global.current : global.latest
        ].provider.request(market, account);

        oracles[global.current].timestamp = uint96(currentTimestamp);
        _updateLatest(latestVersion);
    }

    /// @notice Returns the latest committed version as well as the current timestamp
    /// @return latestVersion The latest committed version
    /// @return currentTimestamp The current timestamp
    function status() external view returns (OracleVersion memory latestVersion, uint256 currentTimestamp) {
        (latestVersion, currentTimestamp) = oracles[global.current].provider.status();
        latestVersion = _handleLatest(latestVersion);
    }

    /// @notice Returns the latest committed version
    function latest() public view returns (OracleVersion memory) {
        return _handleLatest(oracles[global.current].provider.latest());
    }

    /// @notice Returns the current value
    function current() public view returns (uint256) {
        return oracles[global.current].provider.current();
    }

    /// @notice Returns the oracle version at a given timestamp
    /// @param timestamp The timestamp to query
    /// @return atVersion The oracle version at the given timestamp
    /// @return atReceipt The oracle receipt at the given timestamp
    function at(uint256 timestamp) public view returns (OracleVersion memory atVersion, OracleReceipt memory atReceipt) {
        if (timestamp == 0) return (atVersion, atReceipt);

        IOracleProvider provider = oracles[global.current].provider;
        for (uint256 i = global.current - 1; i > 0; i--) {
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
        if (global.current != global.latest) revert OracleOutOfSyncError();

        // if the latest version of the underlying oracle is further ahead than its latest request update its timestamp
        if (global.current != 0) {
            OracleVersion memory latestVersion = oracles[global.current].provider.latest();
            if (latestVersion.timestamp > oracles[global.current].timestamp)
                oracles[global.current].timestamp = uint96(latestVersion.timestamp);
        }

        // add the new oracle registration
        oracles[++global.current] = Epoch(newProvider, uint96(newProvider.current()));
        emit OracleUpdated(newProvider);
    }

    /// @notice Handles updating the latest oracle to the current if it is ready
    /// @param currentOracleLatestVersion The latest version from the current oracle
    function _updateLatest(OracleVersion memory currentOracleLatestVersion) private {
        if (_latestStale(currentOracleLatestVersion)) global.latest = global.current;
    }

    /// @notice Handles overriding the latest version
    /// @dev Applicable if we haven't yet switched over to the current oracle from the latest oracle
    /// @param currentOracleLatestVersion The latest version from the current oracle
    /// @return latestVersion The latest version
    function _handleLatest(
        OracleVersion memory currentOracleLatestVersion
    ) private view returns (OracleVersion memory latestVersion) {
        if (global.current == global.latest) return currentOracleLatestVersion;

        bool isLatestStale = _latestStale(currentOracleLatestVersion);
        latestVersion = isLatestStale ? currentOracleLatestVersion : oracles[global.latest].provider.latest();

        uint256 latestOracleTimestamp =
            uint256(isLatestStale ? oracles[global.current].timestamp : oracles[global.latest].timestamp);
        if (!isLatestStale && latestVersion.timestamp > latestOracleTimestamp)
            (latestVersion, ) = at(latestOracleTimestamp);
    }

    /// @notice Returns whether the latest oracle is ready to be updated
    /// @param currentOracleLatestVersion The latest version from the current oracle
    /// @return Whether the latest oracle is ready to be updated
    function _latestStale(OracleVersion memory currentOracleLatestVersion) private view returns (bool) {
        if (global.current == global.latest) return false;
        if (global.latest == 0) return true;

        if (uint256(oracles[global.latest].timestamp) > oracles[global.latest].provider.latest().timestamp) return false;
        if (uint256(oracles[global.latest].timestamp) >= currentOracleLatestVersion.timestamp) return false;

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
            msg.sender != address(oracles[global.current].provider) &&
            msg.sender != address(oracles[global.latest].provider)
        ) revert OracleNotSubOracleError();
        _;
    }
}
