// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import { UFixed18 } from "@equilibria/root/number/types/UFixed18.sol";
import { Fixed6, Fixed6Lib } from "@equilibria/root/number/types/Fixed6.sol";
import { UFixed6 } from "@equilibria/root/number/types/UFixed6.sol";
import { Token18 } from "@equilibria/root/token/types/Token18.sol";
import { IPythFactory } from "@perennial/v2-oracle/contracts/interfaces/IPythFactory.sol";
import { IMarket } from "@perennial/v2-core/contracts/interfaces/IMarket.sol";
import { IMultiInvoker } from "../MultiInvoker/interfaces/IMultiInvoker.sol";
import { IController } from "../CollateralAccounts/interfaces/IController.sol";
import { MarketTransfer } from "../CollateralAccounts/types/MarketTransfer.sol";
import { Action as CAAction } from "../CollateralAccounts/types/Action.sol";
import { Common, CommonLib } from "@equilibria/root/verifier/types/Common.sol";
import { IManager } from "../TriggerOrders/interfaces/IManager.sol";
import { PlaceOrderAction } from "../TriggerOrders/types/PlaceOrderAction.sol";
import { TriggerOrder } from "../TriggerOrders/types/TriggerOrder.sol";
import { InterfaceFee } from "../TriggerOrders/types/InterfaceFee.sol";
import { Action as TOAction} from "../TriggerOrders/types/Action.sol";

/// @title Compressor
/// @notice Manages claiming fees and updating risk parameters for markets
contract Compressor {
    // constants
    uint256 public immutable PYTH_COMMIT_VALUE = 1;

    // protocol contracts
    Token18 public immutable dsu;
    IMultiInvoker public immutable multiInvoker;
    IPythFactory public immutable pythFactory;
    IController public immutable controller;
    IManager public immutable manager;

    // compressor settings
    address public immutable referrer;

    struct InvokeParams {
        bytes priceCommitmentData;
        bytes32 priceFeedId; // this could be looked up from market
        uint256 version; // could tyie expiry to version

        IMarket market;
        address account;
        address signer;
        Fixed6 tradeCollateral;
        Fixed6 tradeAmount;
        Fixed6 minPrice;
        Fixed6 maxPrice;

        UFixed6 relayerMaxFee;
        UFixed6 triggerOrderMaxFee;
        uint256 group;
        uint256 expiry;
        bytes marketTransferSignature;
        bytes triggerOrderSLSignature;
        bytes triggerOrderTPSignature;

        UFixed6 tradeFeeAmount; // should we calculate this deterministically? (trigger orders)
        uint256 triggerOrderSLId; // Should this be nonce?
        uint256 triggerOrderTPId; // Should this be nonce?
        uint256 marketTransferNonce;
        uint256 triggerOrderSLNonce;
        uint256 triggerOrderTPNonce;
    }

    function invoke(InvokeParams calldata p) external payable sweepDSU {
        // commit price
        bytes32[] memory ids = new bytes32[](1);
        ids[0] = p.priceFeedId;
        _commitPrice(PYTH_COMMIT_VALUE, ids, p.version, p.priceCommitmentData);

        // market transfer
        controller.marketTransferWithSignature(
            MarketTransfer(
                address(p.market),
                p.tradeCollateral,
                CAAction(
                    p.relayerMaxFee,
                    Common(
                        p.account,
                        p.signer,
                        address(controller),
                        p.marketTransferNonce,
                        p.group,
                        p.expiry
                    )
                )
            ),
            p.marketTransferSignature
        );

        // amm market order

        // trigger order (SL)
        manager.placeOrderWithSignature(
            PlaceOrderAction(
                TriggerOrder(
                    p.tradeAmount.gte(Fixed6Lib.ZERO) ? 5 : 6,
                    -1,
                    p.minPrice,
                    p.tradeAmount.mul(Fixed6Lib.NEG_ONE),
                    p.triggerOrderMaxFee,
                    false,
                    referrer,
                    InterfaceFee(
                        p.tradeFeeAmount,
                        referrer,
                        true,
                        false
                    )
                ),
                TOAction(
                    p.market,
                    p.triggerOrderTPId,
                    p.triggerOrderMaxFee,
                    Common(
                        p.account,
                        p.signer,
                        address(manager),
                        p.triggerOrderSLNonce,
                        p.group,
                        p.expiry
                    )
                )
            ),
            p.triggerOrderSLSignature
        );

        // trigger order (TP)
        manager.placeOrderWithSignature(
            PlaceOrderAction(
                TriggerOrder(
                    p.tradeAmount.gte(Fixed6Lib.ZERO) ? 5 : 6,
                    1,
                    p.maxPrice,
                    p.tradeAmount.mul(Fixed6Lib.NEG_ONE),
                    p.triggerOrderMaxFee,
                    false,
                    referrer,
                    InterfaceFee(
                        p.tradeFeeAmount,
                        referrer,
                        true,
                        false
                    )
                ),
                TOAction(
                    p.market,
                    p.triggerOrderTPId,
                    p.triggerOrderMaxFee,
                    Common(
                        p.account,
                        p.signer,
                        address(manager),
                        p.triggerOrderTPNonce,
                        p.group,
                        p.expiry
                    )
                )
            ),
            p.triggerOrderTPSignature
        );
    }

    /// @dev optimistically commit price
    function _commitPrice(uint256 value, bytes32[] memory ids, uint256 version, bytes calldata data) private {
        try pythFactory.commit{value: value}(ids, version, data) { }
        catch (bytes memory) { }
    }

    modifier sweepDSU {
        UFixed18 balanceBefore = dsu.balanceOf();

        _;

        dsu.push(msg.sender, dsu.balanceOf().sub(balanceBefore));
    }
}
