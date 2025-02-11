// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { Factory, IFactory } from "@equilibria/root/attribute/Factory.sol";
import { IInstance } from "@equilibria/root/attribute/Instance.sol";
import { IMarket } from "./interfaces/IMarket.sol";
import { IVerifier } from "./interfaces/IVerifier.sol";
import { IOracleProvider } from "./interfaces/IOracleProvider.sol";
import { IMarketFactory } from "./interfaces/IMarketFactory.sol";
import { OperatorUpdate } from "./types/OperatorUpdate.sol";
import { SignerUpdate } from "./types/SignerUpdate.sol";
import { AccessUpdate } from "./types/AccessUpdate.sol";
import { AccessUpdateBatch } from "./types/AccessUpdateBatch.sol";
import { ProtocolParameter, ProtocolParameterStorage } from "./types/ProtocolParameter.sol";

/// @title MarketFactory
/// @notice Manages creating new markets and global protocol parameters.
contract MarketFactory is IMarketFactory, Factory {
    /// @dev The oracle factory
    IFactory public immutable oracleFactory;

    /// @dev The verifier contract
    IVerifier public immutable verifier;

    /// @dev The global protocol parameters
    ProtocolParameterStorage private _parameter;

    /// @dev Mapping of allowed operators per account
    ///      Note: Operators are allowed to update an account's position and collateral
    mapping(address => mapping(address => bool)) public operators;

    /// @dev Registry of created markets by oracle and payoff
    ///      Note: address(0) is used in place of the deprecated payoff provider field
    mapping(IOracleProvider => mapping(address => IMarket)) private _markets;

    /// @dev The referreral fee level for each referrer for orders
    mapping(address => UFixed6) private _referralFees;

    /// @dev Mapping of allowed signers for each account
    ///      Note: Signers are allowed to update and account's position, but not collateral
    mapping(address => mapping(address => bool)) public signers;

    /// @dev Mapping of allowed protocol-wide operators
    ///      Note: Extensions have operator privileges on all accounts in the protocol
    mapping(address => bool) public extensions;

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

    /// @notice Returns the referral fee for a referrer
    /// @dev If the referrer has no fee set, the default protocol fee is returned
    /// @param referrer The referrer to query
    /// @return The referral fee for the referrer
    function referralFees(address referrer) public view returns (UFixed6) {
        if (referrer == address(0)) return UFixed6Lib.ZERO;
        return _referralFees[referrer].isZero() ? parameter().referralFee : _referralFees[referrer];
    }

    /// @notice Returns authorizaton information for a market order
    /// @param account The account the order is operating on
    /// @param sender The sender of the order
    /// @param signer The signer of the order
    /// @param orderReferrer The referrer of the order
    /// @return isOperator True if the sender is a valid operator for the account
    /// @return isSigner True if the signer is a valid signer for the account
    /// @return orderReferralFee The referral fee for the order
    function authorization(
        address account,
        address sender,
        address signer,
        address orderReferrer
    ) external view returns (bool isOperator, bool isSigner, UFixed6 orderReferralFee) {
        return (
            account == sender || extensions[sender] || operators[account][sender],
            account == signer || signers[account][signer],
            referralFees(orderReferrer)
        );
    }

    /// @notice Updates the global protocol parameters
    /// @param newParameter The new protocol parameters
    function updateParameter(ProtocolParameter memory newParameter) public onlyOwner {
        _parameter.validateAndStore(newParameter);
        emit ParameterUpdated(newParameter);
    }

    /// @notice Updates the status of an extension
    /// @param extension The extension to update to enable protocol-wide
    /// @param newEnabled The new status of the extension
    function updateExtension(address extension, bool newEnabled) external onlyOwner {
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
        verifier.verifyOperatorUpdate(operatorUpdate, signature);
        if (operatorUpdate.common.signer != operatorUpdate.common.account) revert MarketFactoryInvalidSignerError();

        _updateOperator(operatorUpdate.common.account, operatorUpdate.access.accessor, operatorUpdate.access.approved);
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
        verifier.verifySignerUpdate(signerUpdate, signature);
        if (signerUpdate.common.signer != signerUpdate.common.account) revert MarketFactoryInvalidSignerError();

        _updateSigner(signerUpdate.common.account, signerUpdate.access.accessor, signerUpdate.access.approved);
    }

    /// @notice Updates the status of a signer for the caller
    /// @param account The account to update the operator for
    /// @param signer The signer to update
    /// @param newEnabled The new status of the opersignerator
    function _updateSigner(address account, address signer, bool newEnabled) private {
        signers[account][signer] = newEnabled;
        emit SignerUpdated(account, signer, newEnabled);
    }

    /// @notice Updates the status of the list of operators and signers for the caller
    /// @param newOperators The list of operators to update
    /// @param newSigners The list of signers to update
    function updateAccessBatch(AccessUpdate[] calldata newOperators, AccessUpdate[] calldata newSigners) external {
        _updateAccessBatch(msg.sender, newOperators, newSigners);
    }

    /// @notice Updates the status of the list of operators and signers for the caller verified via a signed message
    /// @param accessUpdateBatch The batch access update message to process
    /// @param signature The signature of the batch access update message
    function updateAccessBatchWithSignature(
        AccessUpdateBatch calldata accessUpdateBatch,
        bytes calldata signature
    ) external {
        verifier.verifyAccessUpdateBatch(accessUpdateBatch, signature);
        if (accessUpdateBatch.common.signer != accessUpdateBatch.common.account) revert MarketFactoryInvalidSignerError();

        _updateAccessBatch(accessUpdateBatch.common.account, accessUpdateBatch.operators, accessUpdateBatch.signers);
    }

    /// @notice Updates the status of the list of operators and signers for the caller
    /// @param account The account to update the operators and signers for
    /// @param newOperators The list of operators to update
    /// @param newSigners The list of signers to update
    function _updateAccessBatch(
        address account,
        AccessUpdate[] calldata newOperators,
        AccessUpdate[] calldata newSigners
    ) private {
        for (uint256 i = 0; i < newOperators.length; i++)
            _updateOperator(account, newOperators[i].accessor, newOperators[i].approved);
        for (uint256 i = 0; i < newSigners.length; i++)
            _updateSigner(account, newSigners[i].accessor, newSigners[i].approved);
    }

    /// @notice Updates the referral fee for orders
    /// @param referrer The referrer to update
    /// @param newReferralFee The new referral fee
    function updateReferralFee(address referrer, UFixed6 newReferralFee) external onlyOwner {
        if (newReferralFee.gt(UFixed6Lib.ONE)) revert MarketFactoryInvalidReferralFeeError();

        _referralFees[referrer] = newReferralFee;
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
