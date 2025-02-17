// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { UFixed6 } from "@equilibria/root/number/types/UFixed6.sol";
import { Fixed6 } from "@equilibria/root/number/types/Fixed6.sol";
import { Guarantee, GuaranteeLib, GuaranteeStorageGlobal, GuaranteeStorageLocal } from "../types/Guarantee.sol";
import { Order, OrderLib } from "../types/Order.sol";

abstract contract GuaranteeTester {
    function read() public virtual view returns (Guarantee memory);

    function store(Guarantee memory newGuarantee) public virtual;

    function from(Order memory order, Fixed6 price, UFixed6 referralFee, bool chargeTradeFee) external {
        Guarantee memory newGuarantee = GuaranteeLib.from(order, price, referralFee, chargeTradeFee);
        store(newGuarantee);
    }

    function fresh() public {
        store(GuaranteeLib.fresh());
    }

    function takerPos(Guarantee memory guarantee) public pure returns (UFixed6) {
        return GuaranteeLib.takerPos(guarantee);
    }

    function takerNeg(Guarantee memory guarantee) public pure returns (UFixed6) {
        return GuaranteeLib.takerNeg(guarantee);
    }

    function taker(Guarantee memory guarantee) public pure returns (Fixed6) {
        return GuaranteeLib.taker(guarantee);
    }

    function takerTotal(Guarantee memory guarantee) public pure returns (UFixed6) {
        return GuaranteeLib.takerTotal(guarantee);
    }

    function isEmpty(Guarantee memory guarantee) public pure returns (bool) {
        return GuaranteeLib.isEmpty(guarantee);
    }

    function priceAdjustment(Guarantee memory guarantee, Fixed6 price) public pure returns (Fixed6) {
        return GuaranteeLib.priceAdjustment(guarantee, price);
    }

    function priceDeviation(Guarantee memory guarantee, Fixed6 price) public pure returns (UFixed6) {
        return GuaranteeLib.priceDeviation(guarantee, price);
    }
}

contract GuaranteeGlobalTester is GuaranteeTester {
    GuaranteeStorageGlobal public guarantee;

    function read() public view override returns (Guarantee memory) {
        return guarantee.read();
    }

    function store(Guarantee memory newGuarantee) public override {
        guarantee.store(newGuarantee);
    }
}

contract GuaranteeLocalTester is GuaranteeTester {
    GuaranteeStorageLocal public guarantee;

    function read() public view override returns (Guarantee memory) {
        return guarantee.read();
    }

    function store(Guarantee memory newGuarantee) public override {
        guarantee.store(newGuarantee);
    }
}
