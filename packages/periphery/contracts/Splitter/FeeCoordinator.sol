// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import { IMarketFactory } from "@perennial/v2-core/contracts/interfaces/IMarketFactory.sol";
import { IMarket } from "@perennial/v2-core/contracts/interfaces/IMarket.sol";
import { Factory } from "@equilibria/root/attribute/Factory.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

import { FeeSplitter } from "./FeeSplitter.sol";
import { IFeeCoordinator } from "./interfaces/IFeeCoordinator.sol";

contract FeeCoordinator is IFeeCoordinator, Factory {
    using EnumerableSet for EnumerableSet.AddressSet;

    IMarketFactory public immutable marketFactory;

    EnumerableSet.AddressSet private _markets;

    constructor(IMarketFactory marketFactory_, address implementation_) Factory(implementation_) {
        marketFactory = marketFactory_;
    }

    function initialize() external initializer(1) {
        __Factory__initialize();
    }

    function create(address beneficiary) external onlyOwner returns (FeeSplitter newSplitter) {
        newSplitter = FeeSplitter(address(_create(abi.encodeCall(FeeSplitter.initialize, (beneficiary)))));
    }

    function markets() external view returns (address[] memory) {
        return _markets.values();
    }

    function register(IMarket market) external {
        if (marketFactory.instances(market)) _markets.add(address(market));
    }
}
