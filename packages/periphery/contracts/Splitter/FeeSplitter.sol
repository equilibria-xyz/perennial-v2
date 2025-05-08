// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import { IMarket } from "@perennial/v2-core/contracts/interfaces/IMarket.sol";
import { Instance } from "@equilibria/root/attribute/Instance.sol";
import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { Token18 } from "@equilibria/root/token/types/Token18.sol";
import { Token6 } from "@equilibria/root/token/types/Token6.sol";
import { IEmptySetReserve } from "@equilibria/emptyset-batcher/interfaces/IEmptySetReserve.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

import { FeeCoordinator } from "./FeeCoordinator.sol";
import { IFeeSplitter } from "./interfaces/IFeeSplitter.sol";

contract FeeSplitter is IFeeSplitter, Instance {
    using EnumerableSet for EnumerableSet.AddressSet;

    Token18 public immutable DSU;
    Token6 public immutable USDC;
    IEmptySetReserve public immutable reserve;

    address public beneficiary;

    EnumerableSet.AddressSet private _beneficiaries;
    mapping(address => UFixed6) public _splits;

    constructor(Token18 dsu_, Token6 usdc_, IEmptySetReserve reserve_) {
        DSU = dsu_;
        USDC = usdc_;
        reserve = reserve_;
    }

    function initialize(address beneficiary_) external initializer(1) {
        __Instance__initialize();
        beneficiary = beneficiary_;

        DSU.approve(address(reserve));
    }

    function updateBeneficiary(address beneficiary_) external onlyOwner {
        beneficiary = beneficiary_;
    }

    function updateSplit(address beneficiary_, UFixed6 split) external onlyOwner {
        split.isZero() ? _beneficiaries.remove(beneficiary_) : _beneficiaries.add(beneficiary_);
        _splits[beneficiary_] = split;

        UFixed6 totalSplit;
        for (uint256 i; i < _beneficiaries.length(); i++) totalSplit = totalSplit.add(_splits[_beneficiaries.at(i)]);
        if (totalSplit.gt(UFixed6Lib.ONE)) revert FeeSplitterOverflowError();
    }

    function poke() external {
        address[] memory markets = FeeCoordinator(address(factory())).markets();
        for (uint256 i; i < markets.length; i++) {
            IMarket(markets[i]).claimFee(address(this));
            reserve.redeem(DSU.balanceOf());
        }

        UFixed6 totalFee = USDC.balanceOf(address(this));
        for (uint256 i; i < _beneficiaries.length(); i++)
            USDC.push(_beneficiaries.at(i), totalFee.mul(_splits[_beneficiaries.at(i)]));

        USDC.push(beneficiary);
    }
}
