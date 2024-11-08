// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { IFactory } from "@equilibria/root/attribute/interfaces/IFactory.sol";
import { UFixed6 } from "@equilibria/root/number/types/UFixed6.sol";
import { IVerifier } from "../interfaces/IVerifier.sol";
import { OperatorUpdate } from "../types/OperatorUpdate.sol";
import { SignerUpdate } from "../types/SignerUpdate.sol";
import { AccessUpdate } from "../types/AccessUpdate.sol";
import { AccessUpdateBatch } from "../types/AccessUpdateBatch.sol";
import { ProtocolParameter } from "../types/ProtocolParameter.sol";
import { IMarket } from "./IMarket.sol";
import { IOracleProvider } from "./IOracleProvider.sol";

interface IMarketFactory is IFactory {
    event ParameterUpdated(ProtocolParameter newParameter);
    event ExtensionUpdated(address indexed operator, bool newEnabled);
    event OperatorUpdated(address indexed account, address indexed operator, bool newEnabled);
    event SignerUpdated(address indexed account, address indexed signer, bool newEnabled);
    event ReferralFeeUpdated(address indexed referrer, UFixed6 newFee);
    event MarketCreated(IMarket indexed market, IMarket.MarketDefinition definition);

    // sig: 0x0a37dc74
    error FactoryInvalidPayoffError();
    // sig: 0x5116bce5
    error FactoryInvalidOracleError();
    // sig: 0x213e2260
    error FactoryAlreadyRegisteredError();
    // sig: 0x6928a80f
    error MarketFactoryInvalidSignerError();
    // sig: 0x199d4b3e
    error MarketFactoryInvalidReferralFeeError();

    // sig: 0x4dc1bc59
    error ProtocolParameterStorageInvalidError();

    function oracleFactory() external view returns (IFactory);
    function verifier() external view returns (IVerifier);
    function parameter() external view returns (ProtocolParameter memory);
    function extensions(address extension) external view returns (bool);
    function operators(address account, address operator) external view returns (bool);
    function signers(address signer, address operator) external view returns (bool);
    function referralFees(address referrer) external view returns (UFixed6);
    function markets(IOracleProvider oracle) external view returns (IMarket);
    function authorization(address account, address sender, address signer, address orderReferrer) external view returns (bool, bool, UFixed6);
    function initialize() external;
    function updateParameter(ProtocolParameter memory newParameter) external;
    function updateExtension(address extension, bool newEnabled) external;
    function updateOperator(address operator, bool newEnabled) external;
    function updateOperatorWithSignature(OperatorUpdate calldata operatorUpdate, bytes calldata signature) external;
    function updateSigner(address signer, bool newEnabled) external;
    function updateSignerWithSignature(SignerUpdate calldata signerUpdate, bytes calldata signature) external;
    function updateAccessBatch(AccessUpdate[] calldata operators, AccessUpdate[] calldata signers) external;
    function updateAccessBatchWithSignature(AccessUpdateBatch calldata accessUpdateBatch, bytes calldata signature) external;
    function updateReferralFee(address referrer, UFixed6 newReferralFee) external;
    function create(IMarket.MarketDefinition calldata definition) external returns (IMarket);
}
