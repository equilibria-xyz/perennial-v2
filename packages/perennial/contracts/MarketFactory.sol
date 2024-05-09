// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import "@equilibria/perennial-v2-verifier/contracts/interfaces/IVerifier.sol";
import "@equilibria/root/attribute/Factory.sol";
import "./interfaces/IOracleProvider.sol";
import "./interfaces/IMarketFactory.sol";

/// @title MarketFactory
/// @notice Manages creating new markets and global protocol parameters.
contract MarketFactory is IMarketFactory, Factory {
    /// @dev The oracle factory
    IFactory public immutable oracleFactory;

    /// @dev The verifier contract
    IVerifier public immutable verifier;

    /// @dev The global protocol parameters
    ProtocolParameterStorage private _parameter;

    /// @dev Mapping of allowed protocol-wide operators
    mapping(address => bool) public extensions;

    /// @dev Mapping of allowed operators per account
    mapping(address => mapping(address => bool)) public operators;

    /// @dev Registry of created markets by oracle and payoff
    ///      Note: address(0) is used in place of the deprecated payoff provider field
    mapping(IOracleProvider => mapping(address => IMarket)) private _markets;

    /// @dev The referreral fee level for each referrer
    mapping(address => UFixed6) public referralFee;

    /// @dev Mapping of allowed signers for each account
    mapping(address => mapping(address => bool)) public signers;

    /// @notice Constructs the contract
    /// @param oracleFactory_ The oracle factory
    /// @param verifier_ The verifier contract
    /// @param implementation_ The initial market implementation contract
    constructor(IFactory oracleFactory_, IVerifier verifier_, address implementation_) Factory(implementation_) {
        oracleFactory = oracleFactory_;
        verifier = verifier_;
    }

    /// @notice Initializes the contract state
    function initialize() external initializer(1) {
        __Factory__initialize();
    }

    /// @notice Returns the global protocol parameters
    function parameter() public view returns (ProtocolParameter memory) {
        return _parameter.read();
    }

    function markets(IOracleProvider oracle) external view returns (IMarket) {
        return _markets[oracle][address(0)];
    }

    /// @notice Updates the global protocol parameters
    /// @param newParameter The new protocol parameters
    function updateParameter(ProtocolParameter memory newParameter) public onlyOwner {
        _parameter.validateAndStore(newParameter);
        emit ParameterUpdated(newParameter);
    }

    /// @notice Updates the status of an operator for the caller
    /// @param extension The operator to update to enable protocol-wide
    /// @param newEnabled The new status of the operator
    function updateExtension(address extension, bool newEnabled) external {
        extensions[extension] = newEnabled;
        emit ExtensionUpdated(extension, newEnabled);
    }

    /// @notice Updates the status of an operator for the caller
    /// @param operator The operator to update
    /// @param newEnabled The new status of the operator
    function updateOperator(address operator, bool newEnabled) external {
        _updateOperator(msg.sender, operator, newEnabled);
    }

    /// @notice Updates the status of an operator for the signer verified via a signed message
    /// @param operatorUpdate The operator update message to process
    /// @param signature The signature of the operator update message
    function updateOperatorWithSignature(OperatorUpdate calldata operatorUpdate, bytes calldata signature) external {
        address signer = verifier.verifyOperatorUpdate(operatorUpdate, signature);
        if (signer != operatorUpdate.common.account) revert MarketFactoryInvalidSignerError();

        _updateOperator(operatorUpdate.common.account, operatorUpdate.operator, operatorUpdate.approved);
    }

    /// @notice Updates the status of an operator for the account
    /// @param account The account to update the operator for
    /// @param operator The operator to update
    /// @param newEnabled The new status of the operator
    function _updateOperator(address account, address operator, bool newEnabled) private {
        operators[account][operator] = newEnabled;
        emit OperatorUpdated(account, operator, newEnabled);
    }

    /// @notice Updates the status of a signer for the caller
    /// @param signer The signer to update
    /// @param newEnabled The new status of the opersignerator
    function updateSigner(address signer, bool newEnabled) external {
        _updateSigner(msg.sender, signer, newEnabled);
    }

    /// @notice Updates the status of a signer for the caller verified via a signed message
    /// @param signerUpdate The signer update message to process
    /// @param signature The signature of the signer update message
    function updateSignerWithSignature(SignerUpdate calldata signerUpdate, bytes calldata signature) external {
        address signer = verifier.verifySignerUpdate(signerUpdate, signature);
        if (signer != signerUpdate.common.account) revert MarketFactoryInvalidSignerError();

        _updateSigner(signerUpdate.common.account, signerUpdate.signer, signerUpdate.approved);
    }

    /// @notice Updates the status of a signer for the caller
    /// @param account The account to update the operator for
    /// @param signer The signer to update
    /// @param newEnabled The new status of the opersignerator
    function _updateSigner(address account, address signer, bool newEnabled) private {
        signers[account][signer] = newEnabled;
        emit SignerUpdated(account, signer, newEnabled);
    }


    /// @notice Updates the referral fee for a referrer
    /// @param referrer The referrer to update
    /// @param newReferralFee The new referral fee
    function updateReferralFee(address referrer, UFixed6 newReferralFee) external onlyOwner {
        referralFee[referrer] = newReferralFee;
        emit ReferralFeeUpdated(referrer, newReferralFee);
    }

    /// @notice Creates a new market market with the given definition
    /// @param definition The market definition
    /// @return newMarket New market contract address
    function create(IMarket.MarketDefinition calldata definition) external onlyOwner returns (IMarket newMarket) {
        // verify oracle
        if (!oracleFactory.instances(IInstance(address(definition.oracle)))) revert FactoryInvalidOracleError();

        // verify invariants
        if (_markets[definition.oracle][address(0)] != IMarket(address(0)))
            revert FactoryAlreadyRegisteredError();

        // create and register market
        newMarket = IMarket(address(_create(abi.encodeCall(IMarket.initialize, (definition)))));
        _markets[definition.oracle][address(0)] = newMarket;

        emit MarketCreated(newMarket, definition);
    }
}
