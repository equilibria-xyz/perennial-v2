// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { Fixed6, Fixed6Lib } from "@equilibria/root/number/types/Fixed6.sol";
import { SynBook6 } from "@equilibria/root/synbook/types/SynBook6.sol";
import { IMarket } from "../interfaces/IMarket.sol";

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
    ) internal pure returns (MatchingResult memory result) {
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
    ) internal pure {
        // calculate exposure
        result.exposureMakerNeg = _exposure(position).maker; // TODO: needs to be per position, round up when exposure is charging a fee

        // fill order
        MatchingFillResult memory fillResult = _fill(orderbook, position, _extractMakerOpen(order), synBook, price);
        result.spreadPos = result.spreadPos.add(fillResult.spreadPos);
        result.spreadNeg = result.spreadNeg.add(fillResult.spreadNeg);
        result.spreadMaker = result.spreadMaker.add(fillResult.spreadMaker);
        result.spreadPreLong = fillResult.spreadLong;
        result.spreadPreShort = fillResult.spreadShort;
    }

    function _executeTaker(
        MatchingOrderbook memory orderbook,
        MatchingPosition memory position,
        MatchingOrder memory order,
        SynBook6 memory synBook,
        Fixed6 price,
        MatchingResult memory result
    ) internal pure {
        // calculate close exposure
        MatchingExposure memory exposure = _exposure(position); // TODO: needs to be per position, round up when exposure is charging a fee
        result.exposureLongNeg = exposure.long;
        result.exposureShortNeg = exposure.short;

        // snapshot position and orderbook so both long and short start from the same skew
        MatchingPosition memory position2 = _position(position);
        MatchingOrderbook memory orderbook2 = _orderbook(orderbook);

        // fill positive side of order
        MatchingFillResult memory fillResult = _fill(orderbook, position, _extractTakerPos(order), synBook, price);
        result.spreadPos = result.spreadPos.add(fillResult.spreadPos);
        result.spreadNeg = result.spreadNeg.add(fillResult.spreadNeg);
        result.spreadMaker = result.spreadMaker.add(fillResult.spreadMaker);
        result.spreadCloseLong = fillResult.spreadLong;
        result.spreadCloseShort = fillResult.spreadShort;

        // fill negative side of order
        fillResult = _fill(orderbook2, position2, _extractTakerNeg(order), synBook, price);
        result.spreadPos = result.spreadPos.add(fillResult.spreadPos);
        result.spreadNeg = result.spreadNeg.add(fillResult.spreadNeg);
        result.spreadMaker = result.spreadMaker.add(fillResult.spreadMaker);
        result.spreadCloseLong = fillResult.spreadLong;
        result.spreadCloseShort = fillResult.spreadShort;

        // true up underlying position and orderbook to contain both executed sides for next step
        _fill(orderbook, position, _extractTakerNeg(order), synBook, price);

        // calculate open exposure
        exposure = _exposure(position); // TODO: needs to be per position, round up when exposure is charging a fee
        result.exposureLongPos = exposure.long;
        result.exposureShortPos = exposure.short;
    }

    function _executeOpen(
        MatchingOrderbook memory orderbook,
        MatchingPosition memory position,
        MatchingOrder memory order,
        SynBook6 memory synBook,
        Fixed6 price,
        MatchingResult memory result
    ) internal pure {
        // fill order
        MatchingFillResult memory fillResult = _fill(orderbook, position, _extractMakerOpen(order), synBook, price);
        result.spreadPos = result.spreadPos.add(fillResult.spreadPos);
        result.spreadNeg = result.spreadNeg.add(fillResult.spreadNeg);
        result.spreadMaker = result.spreadMaker.add(fillResult.spreadMaker);
        result.spreadPostLong = fillResult.spreadLong;
        result.spreadPostShort = fillResult.spreadShort;

        // calculate exposure
        result.exposureMakerPos = _exposure(position).maker; // TODO: needs to be per position, round up when exposure is charging a fee
    }

    /// @dev order must be a single uni-directional segment of an order.
    function _fill(
        MatchingOrderbook memory orderbook,
        MatchingPosition memory position,
        MatchingOrder memory order,
        SynBook6 memory synBook,
        Fixed6 price
    ) internal pure returns (MatchingFillResult memory fillResult) {
        // compute the change in exposure after applying the order to the position
        MatchingExposure memory exposure = _exposure(position);
        _apply(position, order);
        MatchingExposure memory change = _change(exposure, _exposure(position));
        Fixed6 changeTotal = _skew(change);

        // compute the synthetic spread taken from the positive and negative sides of the order
        MatchingOrderbook memory latestOrderbook = _orderbook(orderbook);
        _apply(orderbook, _flip(change));
        fillResult.spreadPos = synBook.compute(latestOrderbook.ask, orderbook.ask, price.abs());
        fillResult.spreadNeg = synBook.compute(latestOrderbook.bid, orderbook.bid, price.abs());
        Fixed6 spreadTotal = fillResult.spreadPos.add(fillResult.spreadNeg);

        // compute the portions of the spread that are received by the maker, long, and short sides
        fillResult.spreadMaker = spreadTotal.muldiv(change.maker, changeTotal); // TODO: do the signs always line up here?
        fillResult.spreadLong = spreadTotal.muldiv(change.long, changeTotal);
        fillResult.spreadShort = spreadTotal.muldiv(change.short, changeTotal); // TODO: can have dust here
    }

    function _skew(MatchingPosition memory position) internal pure returns (Fixed6) {
        return Fixed6Lib.from(position.long).sub(Fixed6Lib.from(position.short));
    }

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

    function _change(
        MatchingExposure memory exposureFrom,
        MatchingExposure memory exposureTo
    ) internal pure returns (MatchingExposure memory) {
        return MatchingExposure({
            maker: exposureTo.maker.sub(exposureFrom.maker),
            long: exposureTo.long.sub(exposureFrom.long),
            short: exposureTo.short.sub(exposureFrom.short)
        });
    }
}