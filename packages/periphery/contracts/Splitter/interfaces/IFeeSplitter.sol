// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import { UFixed6 } from "@equilibria/root/number/types/UFixed6.sol";
import { Token6 } from "@equilibria/root/token/types/Token6.sol";
import { Token18 } from "@equilibria/root/token/types/Token18.sol";
import { IEmptySetReserve } from "@equilibria/emptyset-batcher/interfaces/IEmptySetReserve.sol";
import { IInstance } from "@equilibria/root/attribute/interfaces/IInstance.sol";

interface IFeeSplitter is IInstance {
    error FeeSplitterOverflowError();

    function USDC() external view returns (Token6);
    function DSU() external view returns (Token18);
    function reserve() external view returns (IEmptySetReserve);

    function beneficiary() external view returns (address);
    function beneficiaries() external view returns (address[] memory);
    function splits(address beneficiary_) external view returns (UFixed6);

    function initialize(address beneficiary_) external;
    function updateBeneficiary(address beneficiary_) external;
    function updateSplit(address beneficiary_, UFixed6 newSplit) external;
    function poke() external;
}
