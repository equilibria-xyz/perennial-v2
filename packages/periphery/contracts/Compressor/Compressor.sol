// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import { UFixed18 } from "@equilibria/root/number/types/UFixed18.sol";
import { Fixed6, Fixed6Lib } from "@equilibria/root/number/types/Fixed6.sol";
import { UFixed6 } from "@equilibria/root/number/types/UFixed6.sol";
import { Token18 } from "@equilibria/root/token/types/Token18.sol";
import { IOracleFactory } from "@perennial/v2-oracle/contracts/interfaces/IOracleFactory.sol";
import { IPythFactory } from "@perennial/v2-oracle/contracts/interfaces/IPythFactory.sol";
import { IMarket } from "@perennial/v2-core/contracts/interfaces/IMarket.sol";
import { Take } from "@perennial/v2-core/contracts/types/Take.sol";
import { IMultiInvoker } from "../MultiInvoker/interfaces/IMultiInvoker.sol";
import { Controller_Incentivized } from "../CollateralAccounts/Controller_Incentivized.sol";
import { MarketTransfer } from "../CollateralAccounts/types/MarketTransfer.sol";
import { RelayedTake } from "../CollateralAccounts/types/RelayedTake.sol";
import { Action as CAAction } from "../CollateralAccounts/types/Action.sol";
import { Common, CommonLib } from "@equilibria/root/verifier/types/Common.sol";
import { IManager } from "../TriggerOrders/interfaces/IManager.sol";
import { PlaceOrderAction } from "../TriggerOrders/types/PlaceOrderAction.sol";
import { TriggerOrder } from "../TriggerOrders/types/TriggerOrder.sol";
import { InterfaceFee } from "../TriggerOrders/types/InterfaceFee.sol";
import { Action as TOAction} from "../TriggerOrders/types/Action.sol";

/// @title Compressor
/// @notice Compresses the calldata of standard relayer message bundles to reduce calldata size.
contract Compressor {
    // constants
    uint256 public constant PYTH_COMMIT_VALUE = 1;
    uint256 public constant EXPIRY_PERIOD = 2 minutes;

    // protocol contracts
    Token18 public immutable dsu;
    IMultiInvoker public immutable multiInvoker;
    IPythFactory public immutable pythFactory;
    Controller_Incentivized public immutable controller;
    IManager public immutable manager;
    IOracleFactory public immutable oracleFactory;

    // compressor settings
    address public immutable referrer;

    constructor(
        Token18 dsu_,
        IMultiInvoker multiInvoker_,
        IPythFactory pythFactory_,
        Controller_Incentivized controller_,
        IManager manager_,
        IOracleFactory oracleFactory_,
        address referrer_
    ) {
        dsu = dsu_;
        multiInvoker = multiInvoker_;
        pythFactory = pythFactory_;
        controller = controller_;
        manager = manager_;
        oracleFactory = oracleFactory_;
        referrer = referrer_;
    }

    /*
        Encoding instructions
          - Must use the specified immutable `referrer` in all applicable fields
          - Each message should use the same `group`
          - Each message should use and `expiry` value of `version + EXPIRY_PERIOD`
          - Nonces must be incrementing form supplied nonce
            - marketTransferNonce (nonce)
            - marketOrderInnerNonce (nonce + 1)
            - marketOrderOuterNonce (nonce + 2)
            - triggerOrderSLNonce (nonce + 3)
            - triggerOrderTPNonce (nonce + 4)
          - Trigger orders must be full closes of the market order (amount * -1)
          - Trigger orders must use the same interface fee amount
          - Collateral account actions must use the same collateral account fee
          - `priceFeedId` is inferred from the `market`
    */

    struct OrderBundleParams {
        bytes priceCommitmentData;
        uint256 version;

        IMarket market;
        address account;
        address signer;

        Fixed6 tradeCollateral;
        Fixed6 tradeAmount;
        Fixed6 minPrice;
        Fixed6 maxPrice;

        uint256 group;
        uint256 nonce;
        UFixed6 relayerMaxFee;
        UFixed6 triggerOrderMaxFee;

        UFixed6 triggerOrderInterfaceFee;
        uint256 triggerOrderSLId;
        uint256 triggerOrderTPId;

        bytes marketTransferSignature;
        bytes marketOrderOuterSignature;
        bytes marketOrderInnerSignature;
        bytes triggerOrderSLSignature;
        bytes triggerOrderTPSignature;
    }

    function placeOrderBundle(OrderBundleParams calldata p) external payable sweepDSU {
        // commit price
        bytes32[] memory ids = new bytes32[](1);
        ids[0] = oracleFactory.ids(p.market.oracle());
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
                        p.nonce,
                        p.group,
                        p.version + EXPIRY_PERIOD
                    )
                )
            ),
            p.marketTransferSignature
        );

        // amm market order
        controller.relayTake(
            RelayedTake(
                Take(
                    p.tradeAmount,
                    referrer,
                    Common(
                        p.account,
                        p.signer,
                        address(controller),
                        p.nonce + 1,
                        p.group,
                        p.version + EXPIRY_PERIOD
                    )
                ),
                CAAction(
                    p.relayerMaxFee,
                    Common(
                        p.account,
                        p.signer,
                        address(controller),
                        p.nonce + 2,
                        p.group,
                        p.version + EXPIRY_PERIOD
                    )
                )
            ),
            p.marketOrderOuterSignature,
            p.marketOrderInnerSignature
        );

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
                        p.triggerOrderInterfaceFee,
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
                        p.nonce + 3,
                        p.group,
                        p.version + EXPIRY_PERIOD
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
                        p.triggerOrderInterfaceFee,
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
                        p.nonce + 5,
                        p.group,
                        p.version + EXPIRY_PERIOD
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
