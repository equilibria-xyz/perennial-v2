// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { UFixed6 } from "@equilibria/root/number/types/UFixed6.sol";
import { Token6 } from "@equilibria/root/token/types/Token6.sol";
import { Token18 } from "@equilibria/root/token/types/Token18.sol";
import { IEmptySetReserve } from "@equilibria/emptyset-batcher/interfaces/IEmptySetReserve.sol";
import { IInstance } from "@equilibria/root/attribute/interfaces/IInstance.sol";

/// @title IFeeSplitter
/// @notice Interface for a contract that splits fees between a set of beneficiaries
interface IFeeSplitter is IInstance {
    // sig: 0x8272e4c7
    error FeeSplitterOverflowError();

    /// @dev Emitted when the parent beneficiary is updated
    event BeneficiaryUpdated(address indexed newBeneficiary);

    /// @dev Emitted when the split for a child beneficiary is updated
    event SplitUpdated(address indexed beneficiary_, UFixed6 newSplit);

    /// @notice Returns the DSU token
    function USDC() external view returns (Token6);

    /// @notice Returns the DSU token
    function DSU() external view returns (Token18);

    /// @notice Returns the Emptyset reserve
    function reserve() external view returns (IEmptySetReserve);

    /// @notice Returns the parent beneficiary of the fee splitter
    function beneficiary() external view returns (address);

    /// @notice Returns the set of beneficiaries
    function beneficiaries() external view returns (address[] memory);

    /// @notice Returns the split percentage for a given beneficiary
    /// @param beneficiary_ The beneficiary to get the split for
    function splits(address beneficiary_) external view returns (UFixed6);

    /// @notice Initializes the contract with the given parent beneficiary
    /// @param beneficiary_ The parent beneficiary to initialize with
    function initialize(address beneficiary_) external;

    /// @notice Updates the parent beneficiary of the fee splitter
    /// @param beneficiary_ The new parent beneficiary
    function updateBeneficiary(address beneficiary_) external;

    /// @notice Updates the split for the given beneficiary
    /// @dev The sum of all child beneficiary splits must be less than or equal to 100%
    /// @param beneficiary_ The beneficiary to update the split for
    /// @param newSplit The new split percentage
    function updateSplit(address beneficiary_, UFixed6 newSplit) external;

    /// @notice Claims fees from all registered markets and distributes them to the beneficiaries
    /// @dev Unwraps DSU into USDC before distributing
    function poke() external;
}
