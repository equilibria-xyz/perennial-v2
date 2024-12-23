// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Fixed6 } from "@equilibria/root/number/types/Fixed6.sol";
import { SynBook6 } from "@equilibria/root/synbook/types/SynBook6.sol";
import {
    MatchingPosition,
    MatchingOrder,
    MatchingResult,
    MatchingOrderbook,
    MatchingFillResult,
    MatchingExposure,
    MatchingLib
} from "../libs/MatchingLib.sol";

contract MatchingLibTester {
    function execute(
        MatchingPosition memory position,
        MatchingOrder memory order,
        SynBook6 memory synBook,
        Fixed6 price
    ) external view returns (MatchingResult memory result) {
        return MatchingLib.execute(position, order, synBook, price);
    }

    function _executeClose(
        MatchingOrderbook memory orderbook,
        MatchingPosition memory position,
        MatchingOrder memory order,
        SynBook6 memory synBook,
        Fixed6 price,
        MatchingResult memory result
    ) external pure returns (MatchingOrderbook memory, MatchingPosition memory, MatchingResult memory) {
        MatchingLib._executeClose(orderbook, position, order, synBook, price, result);
        return (orderbook, position, result);
    }

    function _executeTaker(
        MatchingOrderbook memory orderbook,
        MatchingPosition memory position,
        MatchingOrder memory order,
        SynBook6 memory synBook,
        Fixed6 price,
        MatchingResult memory result
    ) external view returns (MatchingOrderbook memory, MatchingPosition memory, MatchingResult memory) {
        MatchingLib._executeTaker(orderbook, position, order, synBook, price, result);
        return (orderbook, position, result);
    }

    function _executeOpen(
        MatchingOrderbook memory orderbook,
        MatchingPosition memory position,
        MatchingOrder memory order,
        SynBook6 memory synBook,
        Fixed6 price,
        MatchingResult memory result
    ) external pure returns (MatchingOrderbook memory, MatchingPosition memory, MatchingResult memory) {
        MatchingLib._executeOpen(orderbook, position, order, synBook, price, result);
        return (orderbook, position, result);
    }

    function _fill(
        MatchingOrderbook memory orderbook,
        MatchingPosition memory position,
        MatchingOrder memory order,
        SynBook6 memory synBook,
        Fixed6 price
    ) external pure returns (
        MatchingFillResult memory fillResult,
        MatchingExposure memory exposureClose,
        MatchingExposure memory exposureOpen,
        MatchingOrderbook memory newOrderbook,
        MatchingPosition memory newPosition
    ) {
        (fillResult, exposureClose, exposureOpen) = MatchingLib._fill(orderbook, position, order, synBook, price);
        newOrderbook = orderbook;
        newPosition = position;
    }

    function _skew(MatchingPosition memory position) external pure returns (Fixed6) {
        return MatchingLib._skew(position);
    }

    function _skew(MatchingExposure memory exposure) external pure returns (Fixed6) {
        return MatchingLib._skew(exposure);
    }

    function _position(MatchingPosition memory position) external pure returns (MatchingPosition memory) {
        return MatchingLib._position(position);
    }

    function _orderbook(MatchingOrderbook memory orderbook) external pure returns (MatchingOrderbook memory) {
        return MatchingLib._orderbook(orderbook);
    }
    function _orderbook(MatchingPosition memory position) external pure returns (MatchingOrderbook memory) {
        return MatchingLib._orderbook(position);
    }

    function _apply(MatchingOrderbook memory orderbook, MatchingExposure memory exposure) external pure returns (MatchingOrderbook memory newOrderbook) {
         MatchingLib._apply(orderbook, exposure);
         newOrderbook = orderbook;
    }

    function _apply(MatchingOrderbook memory orderbook, Fixed6 side) external pure returns (MatchingOrderbook memory newOrderbook) {
        MatchingLib._apply(orderbook, side);
        newOrderbook = orderbook;
    }

    function _flip(MatchingExposure memory exposure) external pure returns (MatchingExposure memory) {
        return MatchingLib._flip(exposure);
    }

    function _extractMakerClose(MatchingOrder memory order) external pure returns (MatchingOrder memory) {
        return MatchingLib._extractMakerClose(order);
    }

    function _extractTakerPos(MatchingOrder memory order) external pure returns (MatchingOrder memory) {
        return MatchingLib._extractTakerPos(order);
    }

    function _extractTakerNeg(MatchingOrder memory order) external pure returns (MatchingOrder memory) {
        return MatchingLib._extractTakerNeg(order);
    }

    function _extractMakerOpen(MatchingOrder memory order) external pure returns (MatchingOrder memory) {
        return MatchingLib._extractMakerOpen(order);
    }

    function _extractClose(MatchingOrder memory order) external pure returns (MatchingOrder memory) {
        return MatchingLib._extractClose(order);
    }

    function _apply(MatchingPosition memory position, MatchingOrder memory order) external pure returns (MatchingPosition memory newPosition) {
        MatchingLib._apply(position, order);
        newPosition = position;
    }

    function _exposure(MatchingPosition memory position) external pure returns (MatchingExposure memory) {
        return MatchingLib._exposure(position);
    }

    function _match(MatchingPosition memory position, MatchingOrder memory order) external pure returns (
        MatchingExposure memory exposureClose,
        MatchingExposure memory exposureOpen,
        MatchingExposure memory exposureFilled,
        MatchingPosition memory newPosition
    ) {
        (exposureClose, exposureOpen, exposureFilled) = MatchingLib._match(position, order);
        newPosition = position;
    }

    function _add(
        MatchingExposure memory exposureClose,
        MatchingExposure memory exposureOpen
    ) external pure returns (MatchingExposure memory) {
        return MatchingLib._add(exposureClose, exposureOpen);
    }

    function _sub(
        MatchingExposure memory exposureClose,
        MatchingExposure memory exposureOpen
    ) external pure returns (MatchingExposure memory) {
        return MatchingLib._sub(exposureClose, exposureOpen);
    }

    function _mul(
        MatchingExposure memory exposure,
        MatchingPosition memory position
    ) external pure returns (MatchingExposure memory) {
        return MatchingLib._mul(exposure, position);
    }

    function _div(
        MatchingExposure memory exposure,
        MatchingPosition memory position
    ) external pure returns (MatchingExposure memory) {
        return MatchingLib._div(exposure, position);
    }
}
