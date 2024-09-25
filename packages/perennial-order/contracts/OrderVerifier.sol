// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { SignatureChecker } from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import { VerifierBase } from "@equilibria/root/verifier/VerifierBase.sol";
import { IMarketFactory } from "@equilibria/perennial-v2/contracts/interfaces/IMarketFactory.sol";

import { IOrderVerifier } from "./interfaces/IOrderVerifier.sol";
import { Action, ActionLib } from "./types/Action.sol";
import { CancelOrderAction, CancelOrderActionLib } from "./types/CancelOrderAction.sol";
import { PlaceOrderAction, PlaceOrderActionLib } from "./types/PlaceOrderAction.sol";

contract OrderVerifier is VerifierBase, IOrderVerifier {
    /// @dev market factory to check authorization
    IMarketFactory internal immutable marketFactory;

    /// @dev Initializes the domain separator and parameter caches
    constructor(IMarketFactory _marketFactory) EIP712("Perennial V2 Trigger Orders", "1.0.0") {
        marketFactory = _marketFactory;
    }

    /// @inheritdoc IOrderVerifier
    function verifyAction(Action calldata action, bytes calldata signature)
        external
        validateAndCancel(action.common, signature)
    {
        _verifySignature(action, ActionLib.hash(action), signature);
    }

    /// @inheritdoc IOrderVerifier
    function verifyPlaceOrder(PlaceOrderAction calldata action, bytes calldata signature)
        external
        validateAndCancel(action.action.common, signature)
    {
        _verifySignature(action.action, PlaceOrderActionLib.hash(action), signature);
    }

    /// @inheritdoc IOrderVerifier
    function verifyCancelOrder(CancelOrderAction calldata action, bytes calldata signature)
        external
        validateAndCancel(action.action.common, signature)
    {
        _verifySignature(action.action, CancelOrderActionLib.hash(action), signature);
    }

    function _verifySignature(Action calldata action, bytes32 hash, bytes calldata signature) internal view {
        if (!SignatureChecker.isValidSignatureNow(
            action.common.signer,
            _hashTypedDataV4(hash),
            signature
        )) revert VerifierInvalidSignerError();
    }

    /// @notice Checks account authorization
    /// @param account the account to check authorization for
    /// @param signer the signer of the account
    /// @return whether signer is authorized
    function _authorized(address account, address signer) internal view override returns (bool) {
        (bool isOperator, bool isSigner, ) = marketFactory.authorization(account, address(0), signer, address(0));
        return (isOperator || isSigner);
    }
}
