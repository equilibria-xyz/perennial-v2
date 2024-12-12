// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { UFixed6 } from "@equilibria/root/number/types/UFixed6.sol";
import { Fixed6, Fixed6Lib } from "@equilibria/root/number/types/Fixed6.sol";
import { SynBook6 } from "@equilibria/root/synbook/types/SynBook6.sol";
import { IMarket } from "../interfaces/IMarket.sol";

struct Exposure {
    Fixed6 maker;
    Fixed6 long;
    Fixed6 short;
}

struct Order {
    UFixed6 makerPos;
    UFixed6 makerNeg;
    UFixed6 longPos;
    UFixed6 longNeg;
    UFixed6 shortPos;
    UFixed6 shortNeg;
}

struct Position {
    UFixed6 maker;
    UFixed6 long;
    UFixed6 short;
}

struct Orderbook {
    Fixed6 bid;
    Fixed6 ask;
}

struct FillResult {
    Fixed6 spreadPos;
    Fixed6 spreadNeg;
    Fixed6 spreadMake;
    Fixed6 spreadLong;
    Fixed6 spreadShort;
}

struct Result {
    Fixed6 spreadPos;
    Fixed6 spreadNeg;
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
        Position memory position,
        Order memory order,
        SynBook6 memory synBook,
        Fixed6 price
    ) private pure returns (Result memory) {
        Orderbook memory orderbook = _orderbook(position);

        // fill maker close
        Exposure memory makerCloseExposure = _exposure(position);

        FillResult memory makerCloseFillResult = _fill(orderbook, position, _extractMakerClose(order), synBook, price);

        // fill taker orders (use same starting skew for both positive and negative orders)
        Exposure memory takerCloseExposure = _exposure(position);

        Position memory position2 = _position(position); // snapshot the position to apply to both order components
        FillResult memory takerPosFillResult = _fill(orderbook, position, _extractTakerPos(order), synBook, price);
        FillResult memory takerNegFillResult = _fill(orderbook, position2, _extractTakerNeg(order), synBook, price);
        _apply(position, _extractTakerNeg(order)); // apply both order components to the position before proceeding

        Exposure memory takerOpenExposure = _exposure(position);

        // fill maker open
        FillResult memory makerOpenFillResult = _fill(orderbook, position, _extractMakerOpen(order), synBook, price);

        Exposure memory makerOpenExposure = _exposure(position);

        return _result(
            makerCloseExposure,
            makerCloseFillResult,
            takerCloseExposure,
            takerPosFillResult,
            takerNegFillResult,
            takerOpenExposure,
            makerOpenFillResult,
            takerOpenExposure
        );
    }

    function _result(
        Exposure memory makerCloseExposure,
        FillResult memory makerCloseFillResult,
        Exposure memory takerOpenExposure,
        FillResult memory takerPosFillResult,
        FillResult memory takerNegFillResult,
        Exposure memory takerCloseExposure,
        FillResult memory makerOpenFillResult,
        Exposure memory makerOpenExposure
    ) private pure returns (Result memory result) {
        result.spreadPos = makerCloseFillResult.spreadPos
            .add(takerPosFillResult.spreadPos)
            .add(takerNegFillResult.spreadPos)
            .add(makerOpenFillResult.spreadPos);
        result.spreadNeg = makerCloseFillResult.spreadNeg
            .add(takerPosFillResult.spreadNeg)
            .add(takerNegFillResult.spreadNeg)
            .add(makerOpenFillResult.spreadNeg);
        result.spreadMakerClose = makerCloseFillResult.spreadMaker;
        result.spreadLongClose = makerCloseFillResult.spreadLong;
        result.spreadShortClose = makerCloseFillResult.spreadShort;
        result.spreadMakerTaker = takerPosFillResult.spreadMaker.add(takerNegFillResult.spreadMaker);
        result.spreadLongTaker = takerPosFillResult.spreadLong.add(takerNegFillResult.spreadLong);
        result.spreadShortTaker = takerPosFillResult.spreadShort.add(takerNegFillResult.spreadShort);
        result.spreadMakerOpen = makerOpenFillResult.spreadMaker;
        result.spreadLongOpen = makerOpenFillResult.spreadLong;
        result.spreadShortOpen = makerOpenFillResult.spreadShort;

        result.exposureMakerNeg = makerCloseExposure.makerNeg;
        result.exposureLongNeg = takerCloseExposure.longNeg;
        result.exposureShortNeg = takerCloseExposure.shortNeg;
        result.exposureLongPos = takerOpenExposure.longPos;
        result.exposureShortPos = takerOpenExposure.shortPos;
        result.exposureMakerPos = makerOpenExposure.makerPos;
    }

    function _fill(
        Orderbook memory orderbook,
        Position memory position,
        Order memory order,
        SynBook6 memory synBook,
        Fixed6 price
    ) private pure returns (FillResult memory fillResult) {
        // compute the change in exposure after applying the order to the position
        Exposure memory exposure = _exposure(position);
        _apply(position, order);
        Exposure memory change = _change(exposure, _exposure(position));
        Fixed6 changeTotal = _skew(change);

        // compute the synthetic spread taken from the positive and negative sides of the order
        Orderbook memory newOrderbook = _orderbook(orderbook, _flip(exposure));
        fillResult.spreadPos = synBook.compute(orderbook.pos, newOrderbook.pos, price.abs());
        fillResult.spreadNeg = synBook.compute(orderbook.neg, newOrderbook.neg, price.abs());
        Fixed6 spreadTotal = fillResult.spreadPos.add(fillResult.spreadNeg);

        // compute the portions of the spread that are received by the maker, long, and short sides
        fillResult.spreadMaker = spreadTotal.muldiv(change.maker, changeTotal); // TODO: do the signs always line up here?
        fillResult.spreadLong = spreadTotal.muldiv(change.long, changeTotal);
        fillResult.spreadShort = spreadTotal.muldiv(change.short, changeTotal); // TODO: can have dust here
    }

    function _skew(Position memory position) private pure returns (Fixed6) {
        return Fixed6Lib.from(position.long).sub(Fixed6Lib.from(position.short));
    }

    function _skew(Exposure memory exposure) private pure returns (Fixed6) {
        return exposure.long.add(exposure.short).add(exposure.maker);
    }

    function _position(Position memory position) private pure returns (Position memory) {
        return Position({ maker: position.maker, long: position.long, short: position.short });
    }

    function _orderbook(Position memory position) private pure returns (Orderbook memory) {
        return Orderbook({ bid: _skew(position), ask: _skew(position) }); // TODO: round up when exposure is charging a fee
    }

    function _orderbook(
        Orderbook memory orderbook,
        Exposure memory exposure
    ) private pure returns (Orderbook memory newOrderbook) {
        newOrderbook = Orderbook({ bid: orderbook.bid, ask: orderbook.ask });
        _apply(newOrderbook, exposure.maker);
        _apply(newOrderbook, exposure.long);
        _apply(newOrderbook, exposure.short);
    }

    function _apply(Orderbook memory orderbook, Fixed6 side) private pure {
        if (side.gt(Fixed6Lib.ZERO)) orderbook.ask = orderbook.ask.add(side);
        else orderbook.bid = orderbook.bid.add(side);
    }

    function _flip(Exposure memory exposure) private pure returns (Exposure memory) {
        return Exposure({
            maker: exposure.maker.mul(Fixed6Lib.NEG_ONE),
            long: exposure.long.mul(Fixed6Lib.NEG_ONE),
            short: exposure.short.mul(Fixed6Lib.NEG_ONE)
        });
    }

    function _extractMakerClose(Order memory order) private pure returns (Order memory newOrder) {
        newOrder.makerNeg = order.makerNeg;
    }

    function _extractTakerPos(Order memory order) private pure returns (Order memory newOrder) {
        newOrder.longPos = order.longPos;
        newOrder.shortNeg = order.shortNeg;
    }

    function _extractTakerNeg(Order memory order) private pure returns (Order memory newOrder) {
        newOrder.longNeg = order.longNeg;
        newOrder.shortPos = order.shortPos;
    }

    function _extractMakerOpen(Order memory order) private pure returns (Order memory newOrder) {
        newOrder.makerPos = order.makerPos;
    }

    function _apply(Order memory order, Exposure memory exposure) private pure returns (Fixed6) {
        return Fixed6Lib.from(order.shortPos).sub(Fixed6Lib.from(order.longPos)).add(Fixed6Lib.from(order.makerPos));
    }

    function _apply(Position memory position, Order memory order) private pure {
        position.maker = position.maker.add(order.makerPos).sub(order.makerNeg);
        position.long = position.long.add(order.longPos).sub(order.longNeg);
        position.short = position.short.add(order.shortPos).sub(order.shortNeg);
    }

    function _exposure(Position memory position) private pure returns (Position memory) {
        return Exposure({
            maker: Fixed6Lib.from(position.short).sub(Fixed6Lib.from(position.long))
                .min(Fixed6Lib.from(1, position.maker)).max(Fixed6Lib.from(-1, position.maker)),
            long: Fixed6Lib.from(1, position.long.min(position.maker.add(position.short))),
            short: Fixed6Lib.from(-1, position.short.min(position.maker.add(position.long)))
        });
    }

    function _change(Exposure memory exposureFrom, Exposure memory exposureTo) private pure returns (Exposure memory) {
        return Exposure({
            maker: exposureTo.maker.sub(exposureFrom.maker),
            long: exposureTo.long.sub(exposureFrom.long),
            short: exposureTo.short.sub(exposureFrom.short)
        });
    }
}