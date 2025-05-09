// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import { IMarket } from "@perennial/v2-core/contracts/interfaces/IMarket.sol";
import { Instance } from "@equilibria/root/attribute/Instance.sol";
import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { Token18 } from "@equilibria/root/token/types/Token18.sol";
import { Token6 } from "@equilibria/root/token/types/Token6.sol";
import { IEmptySetReserve } from "@equilibria/emptyset-batcher/interfaces/IEmptySetReserve.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

import { IFeeCoordinator } from "./interfaces/IFeeCoordinator.sol";
import { IFeeSplitter } from "./interfaces/IFeeSplitter.sol";

/// @dev A contract that splits fees between a set of beneficiaries.
contract FeeSplitter is IFeeSplitter, Instance {
    using EnumerableSet for EnumerableSet.AddressSet;

    /// @dev The DSU token.
    Token18 public immutable DSU;

    /// @dev The USDC token.
    Token6 public immutable USDC;

    /// @dev The Emptyset reserve.
    IEmptySetReserve public immutable reserve;

    /// @dev The parent beneficiary of the fee splitter.
    address public beneficiary;

    /// @dev The set of beneficiaries.
    EnumerableSet.AddressSet private _beneficiaries;

    /// @dev The splits for each beneficiary.
    mapping(address => UFixed6) public splits;

    /// @notice Constructs the contract.
    /// @param dsu_ The DSU token.
    /// @param usdc_ The USDC token.
    /// @param reserve_ The Emptyset reserve.
    constructor(Token18 dsu_, Token6 usdc_, IEmptySetReserve reserve_) {
        DSU = dsu_;
        USDC = usdc_;
        reserve = reserve_;
    }

    /// @notice Initializes the contract with the given parent beneficiary.
    function initialize(address beneficiary_) external initializer(1) {
        __Instance__initialize();
        beneficiary = beneficiary_;

        DSU.approve(address(reserve));
    }

    /// @notice Returns the set of beneficiaries.
    function beneficiaries() external view returns (address[] memory) {
        return _beneficiaries.values();
    }

    /// @notice Updates the parent beneficiary of the fee splitter.
    function updateBeneficiary(address newBeneficiary) external onlyOwner {
        beneficiary = newBeneficiary;
        emit BeneficiaryUpdated(newBeneficiary);
    }

    /// @notice Updates the split for the given beneficiary.
    /// @dev The sum of all child beneficiary splits must be less than or equal to 100%.
    /// @param beneficiary_ The beneficiary to update the split for.
    /// @param newSplit The new split percentage.
    function updateSplit(address beneficiary_, UFixed6 newSplit) external onlyOwner {
        newSplit.isZero() ? _beneficiaries.remove(beneficiary_) : _beneficiaries.add(beneficiary_);
        splits[beneficiary_] = newSplit;

        UFixed6 totalSplit;
        for (uint256 i; i < _beneficiaries.length(); i++) totalSplit = totalSplit.add(splits[_beneficiaries.at(i)]);
        if (totalSplit.gt(UFixed6Lib.ONE)) revert FeeSplitterOverflowError();

        emit SplitUpdated(beneficiary_, newSplit);
    }

    /// @notice Claims fees from all registered markets and distributes them to the beneficiaries.
    /// @dev Unwraps DSU into USDC before distributing.
    function poke() external {
        address[] memory markets = IFeeCoordinator(address(factory())).markets();
        for (uint256 i; i < markets.length; i++) {
            IMarket(markets[i]).claimFee(address(this));
            reserve.redeem(DSU.balanceOf());
        }

        UFixed6 totalFee = USDC.balanceOf();
        for (uint256 i; i < _beneficiaries.length(); i++)
            USDC.push(_beneficiaries.at(i), totalFee.mul(splits[_beneficiaries.at(i)]));

        USDC.push(beneficiary);
    }
}
