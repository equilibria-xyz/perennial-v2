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
    Fixed6 spreadMakerClose;
    Fixed6 spreadLongClose;
    Fixed6 spreadShortClose;
    Fixed6 spreadMakerTaker;
    Fixed6 spreadLongTaker;
    Fixed6 spreadShortTaker;
    Fixed6 spreadMakerOpen;
    Fixed6 spreadLongOpen;
    Fixed6 spreadShortOpen;
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
    ) internal pure returns (MatchingResult memory) { // TODO: take into account guarantee?
        MatchingOrderbook memory orderbook = _orderbook(position);

        // fill maker close
        MatchingExposure memory makerCloseExposure = _exposure(position); // TODO: needs to be per position, round up when exposure is charging a fee

        MatchingFillResult memory makerCloseFillResult = _fill(orderbook, position, _extractMakerClose(order), synBook, price);

        // fill taker orders (use same starting skew for both positive and negative orders)
        MatchingExposure memory takerCloseExposure = _exposure(position);

        MatchingPosition memory position2 = _position(position); // snapshot the position to apply to both order components
        MatchingFillResult memory takerPosFillResult = _fill(orderbook, position, _extractTakerPos(order), synBook, price);
        MatchingFillResult memory takerNegFillResult = _fill(orderbook, position2, _extractTakerNeg(order), synBook, price);
        _apply(position, _extractTakerNeg(order)); // apply both order components to the position before proceeding

        MatchingExposure memory takerOpenExposure = _exposure(position);

        // fill maker open
        MatchingFillResult memory makerOpenFillResult = _fill(orderbook, position, _extractMakerOpen(order), synBook, price);

        MatchingExposure memory makerOpenExposure = _exposure(position);

        return _result( // TODO: verify all warnings
            orderbook,  // TODO: compile w/o optimizer
            makerCloseExposure,
            makerCloseFillResult,
            takerCloseExposure,
            takerPosFillResult,
            takerNegFillResult,
            takerOpenExposure,
            makerOpenFillResult,
            makerOpenExposure
        );
    }

    function _result(
        MatchingOrderbook memory orderbook,
        MatchingExposure memory makerCloseExposure,
        MatchingFillResult memory makerCloseFillResult,
        MatchingExposure memory takerOpenExposure,
        MatchingFillResult memory takerPosFillResult,
        MatchingFillResult memory takerNegFillResult,
        MatchingExposure memory takerCloseExposure,
        MatchingFillResult memory makerOpenFillResult,
        MatchingExposure memory makerOpenExposure
    ) private pure returns (MatchingResult memory result) {
        result.spreadPos = makerCloseFillResult.spreadPos
            .add(takerPosFillResult.spreadPos)
            .add(takerNegFillResult.spreadPos)
            .add(makerOpenFillResult.spreadPos);
        result.exposurePos = UFixed6Lib.from(orderbook.ask.sub(orderbook.midpoint));
        result.spreadNeg = makerCloseFillResult.spreadNeg
            .add(takerPosFillResult.spreadNeg)
            .add(takerNegFillResult.spreadNeg)
            .add(makerOpenFillResult.spreadNeg);
        result.exposureNeg = UFixed6Lib.from(orderbook.midpoint.sub(orderbook.bid));
        result.spreadMakerClose = makerCloseFillResult.spreadMaker;
        result.spreadLongClose = makerCloseFillResult.spreadLong;
        result.spreadShortClose = makerCloseFillResult.spreadShort;
        result.spreadMakerTaker = takerPosFillResult.spreadMaker.add(takerNegFillResult.spreadMaker);
        result.spreadLongTaker = takerPosFillResult.spreadLong.add(takerNegFillResult.spreadLong);
        result.spreadShortTaker = takerPosFillResult.spreadShort.add(takerNegFillResult.spreadShort);
        result.spreadMakerOpen = makerOpenFillResult.spreadMaker;
        result.spreadLongOpen = makerOpenFillResult.spreadLong;
        result.spreadShortOpen = makerOpenFillResult.spreadShort;

        result.exposureMakerNeg = makerCloseExposure.maker;
        result.exposureLongNeg = takerCloseExposure.long;
        result.exposureShortNeg = takerCloseExposure.short;
        result.exposureLongPos = takerOpenExposure.long;
        result.exposureShortPos = takerOpenExposure.short;
        result.exposureMakerPos = makerOpenExposure.maker;
    }

    function _fill(
        MatchingOrderbook memory orderbook,
        MatchingPosition memory position,
        MatchingOrder memory order,
        SynBook6 memory synBook,
        Fixed6 price
    ) private pure returns (MatchingFillResult memory fillResult) {
        // compute the change in exposure after applying the order to the position
        MatchingExposure memory exposure = _exposure(position);
        _apply(position, order);
        MatchingExposure memory change = _change(exposure, _exposure(position));
        Fixed6 changeTotal = _skew(change);

        // compute the synthetic spread taken from the positive and negative sides of the order
        MatchingOrderbook memory newOrderbook = _orderbook(orderbook, _flip(exposure)); // TODO: need to update `orderbook`
        fillResult.spreadPos = synBook.compute(orderbook.ask, newOrderbook.ask, price.abs());
        fillResult.spreadNeg = synBook.compute(orderbook.bid, newOrderbook.bid, price.abs());
        Fixed6 spreadTotal = fillResult.spreadPos.add(fillResult.spreadNeg);

        // compute the portions of the spread that are received by the maker, long, and short sides
        fillResult.spreadMaker = spreadTotal.muldiv(change.maker, changeTotal); // TODO: do the signs always line up here?
        fillResult.spreadLong = spreadTotal.muldiv(change.long, changeTotal);
        fillResult.spreadShort = spreadTotal.muldiv(change.short, changeTotal); // TODO: can have dust here
    }

    function _skew(MatchingPosition memory position) private pure returns (Fixed6) {
        return Fixed6Lib.from(position.long).sub(Fixed6Lib.from(position.short));
    }

    function _skew(MatchingExposure memory exposure) private pure returns (Fixed6) {
        return exposure.long.add(exposure.short).add(exposure.maker);
    }

    function _position(MatchingPosition memory position) private pure returns (MatchingPosition memory) {
        return MatchingPosition({ maker: position.maker, long: position.long, short: position.short });
    }

    function _orderbook(MatchingPosition memory position) private pure returns (MatchingOrderbook memory) {
        Fixed6 midpoint = _skew(position);
        return MatchingOrderbook({ midpoint: midpoint, bid: midpoint, ask: midpoint });
    }

    function _orderbook(
        MatchingOrderbook memory orderbook,
        MatchingExposure memory exposure
    ) private pure returns (MatchingOrderbook memory newOrderbook) {
        _apply(newOrderbook, exposure.maker);
        _apply(newOrderbook, exposure.long);
        _apply(newOrderbook, exposure.short);
    }

    function _apply(MatchingOrderbook memory orderbook, Fixed6 side) private pure {
        if (side.gt(Fixed6Lib.ZERO)) orderbook.ask = orderbook.ask.add(side);
        else orderbook.bid = orderbook.bid.add(side);
    }

    function _flip(MatchingExposure memory exposure) private pure returns (MatchingExposure memory) {
        return MatchingExposure({
            maker: exposure.maker.mul(Fixed6Lib.NEG_ONE),
            long: exposure.long.mul(Fixed6Lib.NEG_ONE),
            short: exposure.short.mul(Fixed6Lib.NEG_ONE)
        });
    }

    function _extractMakerClose(MatchingOrder memory order) private pure returns (MatchingOrder memory newOrder) {
        newOrder.makerNeg = order.makerNeg;
    }

    function _extractTakerPos(MatchingOrder memory order) private pure returns (MatchingOrder memory newOrder) {
        newOrder.longPos = order.longPos;
        newOrder.shortNeg = order.shortNeg;
    }

    function _extractTakerNeg(MatchingOrder memory order) private pure returns (MatchingOrder memory newOrder) {
        newOrder.longNeg = order.longNeg;
        newOrder.shortPos = order.shortPos;
    }

    function _extractMakerOpen(MatchingOrder memory order) private pure returns (MatchingOrder memory newOrder) {
        newOrder.makerPos = order.makerPos;
    }

    function _apply(MatchingOrder memory order, MatchingExposure memory exposure) private pure returns (Fixed6) {
        return Fixed6Lib.from(order.shortPos).sub(Fixed6Lib.from(order.longPos)).add(Fixed6Lib.from(order.makerPos));
    }

    function _apply(MatchingPosition memory position, MatchingOrder memory order) private pure {
        position.maker = position.maker.add(order.makerPos).sub(order.makerNeg);
        position.long = position.long.add(order.longPos).sub(order.longNeg);
        position.short = position.short.add(order.shortPos).sub(order.shortNeg);
    }

    function _exposure(MatchingPosition memory position) private pure returns (MatchingExposure memory) {
        return MatchingExposure({
            maker: Fixed6Lib.from(position.short).sub(Fixed6Lib.from(position.long))
                .min(Fixed6Lib.from(1, position.maker)).max(Fixed6Lib.from(-1, position.maker)),
            long: Fixed6Lib.from(1, position.long.min(position.maker.add(position.short))),
            short: Fixed6Lib.from(-1, position.short.min(position.maker.add(position.long)))
        });
    }

    function _change(MatchingExposure memory exposureFrom, MatchingExposure memory exposureTo) private pure returns (MatchingExposure memory) {
        return MatchingExposure({
            maker: exposureTo.maker.sub(exposureFrom.maker),
            long: exposureTo.long.sub(exposureFrom.long),
            short: exposureTo.short.sub(exposureFrom.short)
        });
    }
}