//SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { IVault } from "./IVault.sol";

interface IMakerVault is IVault {
    // sig: 0xf90641dc
    error MakerStrategyInsufficientCollateralError();
    // sig: 0xb86270e3
    error MakerStrategyInsufficientAssetsError();
}
