// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { Fixed6, Fixed6Lib } from "@equilibria/root/number/types/Fixed6.sol";
import { SynBook6 } from "@equilibria/root/synbook/types/SynBook6.sol";
import { IMarket } from "../interfaces/IMarket.sol";
import "hardhat/console.sol";

struct MatchingExposure {
    Fixed6 maker;
    Fixed6 long;
    Fixed6 short;
}

struct MatchingOrder {
    UFixed6 makerPos;
    UFixed6 makerNeg;
    UFixed6 longPos;
    UFixed6 longNeg;
    UFixed6 shortPos;
    UFixed6 shortNeg;
}

struct MatchingPosition {
    UFixed6 maker;
    UFixed6 long;
    UFixed6 short;
}

struct MatchingOrderbook {
    Fixed6 midpoint;
    Fixed6 bid;
    Fixed6 ask;
}

struct MatchingFillResult {
    Fixed6 spreadPos;
    Fixed6 spreadNeg;
    Fixed6 spreadMaker;
    Fixed6 spreadLong;
    Fixed6 spreadShort;
}

struct MatchingResult {
    Fixed6 spreadPos;
    UFixed6 exposurePos;
    Fixed6 spreadNeg;
    UFixed6 exposureNeg;
    Fixed6 spreadMaker;
    Fixed6 spreadPreLong;
    Fixed6 spreadPreShort;
    Fixed6 spreadCloseLong;
    Fixed6 spreadCloseShort;
    Fixed6 spreadPostLong;
    Fixed6 spreadPostShort;
    Fixed6 exposureMakerPos;
    Fixed6 exposureMakerNeg;
    Fixed6 exposureLongPos;
    Fixed6 exposureLongNeg;
    Fixed6 exposureShortPos;
    Fixed6 exposureShortNeg;
}

/// @title MatchingLib
/// @dev (external-safe): this library is safe to externalize
///     // need to apply to appropriate accumulator
        // - maker close -> applies to position - makerNeg
        // - long / short -> applies to position - neg [SpreadValue]
        // - maker open -> applies to position - neg + takerPos
/// @notice
library MatchingLib {
    function execute(
        MatchingPosition memory position,
        MatchingOrder memory order,
        SynBook6 memory synBook,
        Fixed6 price
    ) internal view returns (MatchingResult memory result) {
        MatchingOrderbook memory orderbook = _orderbook(position);

        _executeClose(orderbook, position, order, synBook, price, result);
        _executeTaker(orderbook, position, order, synBook, price, result);
        _executeOpen(orderbook, position, order, synBook, price, result);

        result.exposurePos = UFixed6Lib.from(orderbook.ask.sub(orderbook.midpoint));
        result.exposureNeg = UFixed6Lib.from(orderbook.midpoint.sub(orderbook.bid));
    }

    function _executeClose(
        MatchingOrderbook memory orderbook,
        MatchingPosition memory position,
        MatchingOrder memory order,
        SynBook6 memory synBook,
        Fixed6 price,
        MatchingResult memory result
    ) internal view {
        (MatchingFillResult memory fillResult, MatchingExposure memory exposureClose, ) =
            _fill(orderbook, position, _extractMakerOpen(order), synBook, price);
        result.spreadPos = result.spreadPos.add(fillResult.spreadPos);
        result.spreadNeg = result.spreadNeg.add(fillResult.spreadNeg);
        result.spreadMaker = result.spreadMaker.add(fillResult.spreadMaker);
        result.spreadPreLong = fillResult.spreadLong;
        result.spreadPreShort = fillResult.spreadShort;
        result.exposureMakerNeg = exposureClose.maker;
    }

    function _executeTaker(
        MatchingOrderbook memory orderbook,
        MatchingPosition memory position,
        MatchingOrder memory order,
        SynBook6 memory synBook,
        Fixed6 price,
        MatchingResult memory result
    ) internal view {
        // snapshot position and orderbook so both long and short start from the same skew
        MatchingPosition memory position2 = _position(position);
        MatchingOrderbook memory orderbook2 = _orderbook(orderbook);

        // fill positive side of order
        (MatchingFillResult memory fillResult, MatchingExposure memory exposureClose, ) =
            _fill(orderbook, position, _extractTakerPos(order), synBook, price);
        result.spreadPos = result.spreadPos.add(fillResult.spreadPos);
        result.spreadNeg = result.spreadNeg.add(fillResult.spreadNeg);
        result.spreadMaker = result.spreadMaker.add(fillResult.spreadMaker);
        result.spreadCloseLong = fillResult.spreadLong;
        result.spreadCloseShort = fillResult.spreadShort;

        // TODO: if one leg full closes we could end up with a non-zero spread going to a zero closed position

        // fill negative side of order
        (MatchingFillResult memory fillResult2, , ) =
            _fill(orderbook2, position2, _extractTakerNeg(order), synBook, price);
        result.spreadPos = result.spreadPos.add(fillResult2.spreadPos);
        result.spreadNeg = result.spreadNeg.add(fillResult2.spreadNeg);
        result.spreadMaker = result.spreadMaker.add(fillResult2.spreadMaker);
        result.spreadCloseLong = fillResult2.spreadLong;
        result.spreadCloseShort = fillResult2.spreadShort;

        // true up underlying position and orderbook to contain both executed sides for next step
        ( , , MatchingExposure memory exposureOpen) =
            _fill(orderbook, position, _extractTakerNeg(order), synBook, price);

        // calculate exposure
        result.exposureLongNeg = exposureClose.long;
        result.exposureShortNeg = exposureClose.short;
        result.exposureLongPos = exposureOpen.long;
        result.exposureShortPos = exposureOpen.short;
    }

    function _executeOpen(
        MatchingOrderbook memory orderbook,
        MatchingPosition memory position,
        MatchingOrder memory order,
        SynBook6 memory synBook,
        Fixed6 price,
        MatchingResult memory result
    ) internal view {
        (MatchingFillResult memory fillResult, , MatchingExposure memory exposureOpen) =
            _fill(orderbook, position, _extractMakerOpen(order), synBook, price);
        result.spreadPos = result.spreadPos.add(fillResult.spreadPos);
        result.spreadNeg = result.spreadNeg.add(fillResult.spreadNeg);
        result.spreadMaker = result.spreadMaker.add(fillResult.spreadMaker);
        result.spreadPostLong = fillResult.spreadLong;
        result.spreadPostShort = fillResult.spreadShort;
        result.exposureMakerPos = exposureOpen.maker;
    }

    /// @dev order must be a single uni-directional segment of an order.
    function _fill(
        MatchingOrderbook memory orderbook,
        MatchingPosition memory position,
        MatchingOrder memory order,
        SynBook6 memory synBook,
        Fixed6 price
    ) internal view returns (
        MatchingFillResult memory fillResult,
        MatchingExposure memory exposureClose,
        MatchingExposure memory exposureOpen
    ) {
        MatchingExposure memory exposureFilled;
        // compute the change in exposure after applying the order to the position
        (exposureClose, exposureOpen, exposureFilled) = _match(position, order);
        Fixed6 filledTotal = _skew(exposureFilled);

        MatchingExposure memory exposureOrder = _flip(exposureFilled);
        Fixed6 exposureTotal = _skew(exposureOrder);

        // compute the synthetic spread taken from the positive and negative sides of the order
        MatchingOrderbook memory latestOrderbook = _orderbook(orderbook);
        _apply(orderbook, exposureOrder);

        if (exposureTotal.gt(Fixed6Lib.ZERO))
            fillResult.spreadPos = synBook.compute(latestOrderbook.ask, exposureTotal, price.abs());
        else
            fillResult.spreadNeg = synBook.compute(latestOrderbook.bid, exposureTotal, price.abs());
        Fixed6 spreadTotal = fillResult.spreadPos.add(fillResult.spreadNeg);

        // compute the portions of the spread that are received by the maker, long, and short sides
        fillResult.spreadMaker = spreadTotal.muldiv(exposureFilled.maker, filledTotal);
        fillResult.spreadLong = spreadTotal.muldiv(exposureFilled.long, filledTotal);
        fillResult.spreadShort = spreadTotal.muldiv(exposureFilled.short, filledTotal); // TODO: can have dust here
    }

    function _skew(MatchingPosition memory position) internal pure returns (Fixed6) {
        return Fixed6Lib.from(position.long).sub(Fixed6Lib.from(position.short));
    }

    /// @dev assumes all skew is in a single direction
    function _skew(MatchingExposure memory exposure) internal pure returns (Fixed6) {
        return exposure.long.add(exposure.short).add(exposure.maker);
    }

    function _position(MatchingPosition memory position) internal pure returns (MatchingPosition memory) {
        return MatchingPosition({ maker: position.maker, long: position.long, short: position.short });
    }

    function _orderbook(MatchingOrderbook memory orderbook) internal pure returns (MatchingOrderbook memory) {
        return MatchingOrderbook({ midpoint: orderbook.midpoint, bid: orderbook.bid, ask: orderbook.ask });
    }
    function _orderbook(MatchingPosition memory position) internal pure returns (MatchingOrderbook memory) {
        Fixed6 midpoint = _skew(position);
        return MatchingOrderbook({ midpoint: midpoint, bid: midpoint, ask: midpoint });
    }

    function _apply(MatchingOrderbook memory orderbook, MatchingExposure memory exposure) internal pure {
        _apply(orderbook, exposure.maker);
        _apply(orderbook, exposure.long);
        _apply(orderbook, exposure.short);
    }

    function _apply(MatchingOrderbook memory orderbook, Fixed6 side) internal pure {
        if (side.gt(Fixed6Lib.ZERO)) orderbook.ask = orderbook.ask.add(side);
        else orderbook.bid = orderbook.bid.add(side);
    }

    function _flip(MatchingExposure memory exposure) internal pure returns (MatchingExposure memory) {
        return MatchingExposure({
            maker: exposure.maker.mul(Fixed6Lib.NEG_ONE),
            long: exposure.long.mul(Fixed6Lib.NEG_ONE),
            short: exposure.short.mul(Fixed6Lib.NEG_ONE)
        });
    }

    function _extractMakerClose(MatchingOrder memory order) internal pure returns (MatchingOrder memory newOrder) {
        newOrder.makerNeg = order.makerNeg;
    }

    function _extractTakerPos(MatchingOrder memory order) internal pure returns (MatchingOrder memory newOrder) {
        newOrder.longPos = order.longPos;
        newOrder.shortNeg = order.shortNeg;
    }

    function _extractTakerNeg(MatchingOrder memory order) internal pure returns (MatchingOrder memory newOrder) {
        newOrder.longNeg = order.longNeg;
        newOrder.shortPos = order.shortPos;
    }

    function _extractMakerOpen(MatchingOrder memory order) internal pure returns (MatchingOrder memory newOrder) {
        newOrder.makerPos = order.makerPos;
    }

    function _extractClose(MatchingOrder memory order) internal pure returns (MatchingOrder memory newOrder) {
        newOrder.makerNeg = order.makerNeg;
        newOrder.longNeg = order.longNeg;
        newOrder.shortNeg = order.shortNeg;
    }

    function _apply(MatchingPosition memory position, MatchingOrder memory order) internal pure {
        position.maker = position.maker.add(order.makerPos).sub(order.makerNeg);
        position.long = position.long.add(order.longPos).sub(order.longNeg);
        position.short = position.short.add(order.shortPos).sub(order.shortNeg);
    }

    function _exposure(MatchingPosition memory position) internal pure returns (MatchingExposure memory) {
        return MatchingExposure({
            maker: Fixed6Lib.from(position.short).sub(Fixed6Lib.from(position.long))
                .min(Fixed6Lib.from(1, position.maker)).max(Fixed6Lib.from(-1, position.maker)),
            long: Fixed6Lib.from(1, position.long.min(position.maker.add(position.short))),
            short: Fixed6Lib.from(-1, position.short.min(position.maker.add(position.long)))
        });
    }

    /// @dev order must be a single uni-directional segment of an order.
    function _match(
        MatchingPosition memory position,
        MatchingOrder memory order
    ) internal pure returns (
        MatchingExposure memory exposureClose,
        MatchingExposure memory exposureOpen,
        MatchingExposure memory exposureFilled
    ) {
        MatchingPosition memory latestPosition = _position(position);
        MatchingPosition memory closedPosition = _position(position);
        _apply(closedPosition, _extractClose(order));
        _apply(position, order);

        // calculate exposure per position unit on open and close
        exposureClose = _div(_exposure(latestPosition), latestPosition);
        exposureOpen = _div(_exposure(position), position);

        // calulate total exposure filled by side
        exposureFilled = _sub(
            _div(_mul(_exposure(position), closedPosition), position),
            _div(_mul(_exposure(latestPosition), closedPosition), latestPosition)
        );
    }

    function _add(
        MatchingExposure memory exposureClose,
        MatchingExposure memory exposureOpen
    ) internal pure returns (MatchingExposure memory) {
        return MatchingExposure({
            maker: exposureClose.maker.add(exposureOpen.maker),
            long: exposureClose.long.add(exposureOpen.long),
            short: exposureClose.short.add(exposureOpen.short)
        });
    }

    function _sub(
        MatchingExposure memory exposureClose,
        MatchingExposure memory exposureOpen
    ) internal pure returns (MatchingExposure memory) {
        return MatchingExposure({
            maker: exposureClose.maker.sub(exposureOpen.maker),
            long: exposureClose.long.sub(exposureOpen.long),
            short: exposureClose.short.sub(exposureOpen.short)
        });
    }

    function _mul(
        MatchingExposure memory exposure,
        MatchingPosition memory position
    ) internal pure returns (MatchingExposure memory) {
        return MatchingExposure({
            maker: exposure.maker.mul(Fixed6Lib.from(position.maker)),
            long: exposure.long.mul(Fixed6Lib.from(position.long)),
            short: exposure.short.mul(Fixed6Lib.from(position.short))
        });
    }

    function _div(
        MatchingExposure memory exposure,
        MatchingPosition memory position
    ) internal pure returns (MatchingExposure memory) {
        return MatchingExposure({
            maker: position.maker.isZero() ? Fixed6Lib.ZERO : exposure.maker.div(Fixed6Lib.from(position.maker)),
            long: position.long.isZero() ? Fixed6Lib.ZERO : exposure.long.div(Fixed6Lib.from(position.long)),
            short: position.short.isZero() ? Fixed6Lib.ZERO : exposure.short.div(Fixed6Lib.from(position.short))
        });
    }
}