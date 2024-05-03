// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import "@equilibria/root/attribute/Factory.sol";
import "./interfaces/IOracleProvider.sol";
import "./interfaces/IMarketFactory.sol";

/// @title MarketFactory
/// @notice Manages creating new markets and global protocol parameters.
contract MarketFactory is IMarketFactory, Factory {
    /// @dev The oracle factory
    IFactory public immutable oracleFactory;

    /// @dev The global protocol parameters
    ProtocolParameterStorage private _parameter;

    /// @dev Mapping of allowed operators for each account
    mapping(address => mapping(address => bool)) public operators;

    /// @dev Registry of created markets by oracle and payoff
    ///      Note: address(0) is used in place of the deprecated payoff provider field
    mapping(IOracleProvider => mapping(address => IMarket)) private _markets;

    /// @dev The referreral fee level for each referrer for orders
    mapping(address => UFixed6) public orderReferralFees;

    /// @dev The referreral fee level for each referrer for guarantees
    mapping(address => UFixed6) public guaranteeReferralFees;

    /// @dev Mapping of allowed signers for each account
    mapping(address => mapping(address => bool)) public signers;

    /// @notice Constructs the contract
    /// @param oracleFactory_ The oracle factory
    /// @param implementation_ The initial market implementation contract
    constructor(IFactory oracleFactory_, address implementation_) Factory(implementation_) {
        oracleFactory = oracleFactory_;
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

    /// @notice Returns a snapshot of the parameter settings for a market update
    /// @param account The account being operated on
    /// @param operator The operator of the update
    /// @param signer The signer of the update
    /// @param orderReferrer The referrer of the order of the update
    /// @param guaranteeReferrer The referrer of the guarantee of the update
    function status(
        address account,
        address operator,
        address signer,
        address orderReferrer,
        address guaranteeReferrer
    ) external view returns (bool isOperator, bool isSigner, UFixed6 orderReferralFee, UFixed6 guaranteeReferralFee) {
        return (
            operators[account][operator],
            signers[account][signer],
            orderReferralFees[orderReferrer],
            guaranteeReferralFees[guaranteeReferrer]
        );
    }

    /// @notice Updates the status of an operator for the caller
    /// @param operator The operator to update
    /// @param newEnabled The new status of the operator
    function updateOperator(address operator, bool newEnabled) external {
        operators[msg.sender][operator] = newEnabled;
        emit OperatorUpdated(msg.sender, operator, newEnabled);
    }

    /// @notice Updates the status of a signer for the caller
    /// @param signer The signer to update
    /// @param newEnabled The new status of the opersignerator
    function updateSigner(address signer, bool newEnabled) external {
        signers[msg.sender][signer] = newEnabled;
        emit SignerUpdated(msg.sender, signer, newEnabled);
    }

    /// @notice Updates the referral fee for orders
    /// @param referrer The referrer to update
    /// @param newReferralFee The new referral fee
    function updateOrderReferralFee(address referrer, UFixed6 newReferralFee) external onlyOwner {
        orderReferralFees[referrer] = newReferralFee;
        emit OrderReferralFeeUpdated(referrer, newReferralFee);
    }

    /// @notice Updates the referral fee for guarantees
    /// @param referrer The referrer to update
    /// @param newReferralFee The new referral fee
    function updateGuaranteeReferralFee(address referrer, UFixed6 newReferralFee) external onlyOwner {
        guaranteeReferralFees[referrer] = newReferralFee;
        emit GuaranteeReferralFeeUpdated(referrer, newReferralFee);
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
