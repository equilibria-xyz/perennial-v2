//SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@openzeppelin/contracts-upgradeable/interfaces/IERC4626Upgradeable.sol";
import "@equilibria/perennial-v2/contracts/interfaces/IFactory.sol";
import "@equilibria/root-v2/contracts/UFixed6.sol";

interface IBalancedVault {
    event Updated(IMarket indexed product, Fixed6 targetPosition, Fixed6 targetCollateral);

    error BalancedVaultInvalidMaxLeverage();

    function initialize(IERC20Upgradeable dsu_) external;
    function sync() external;
    function healthy() external view returns (bool);
    function factory() external view returns (IFactory);
    function long() external view returns (IMarket);
    function short() external view returns (IMarket);
    function targetLeverage() external view returns (UFixed6);
    function maxLeverage() external view returns (UFixed6);
    function fixedFloat() external view returns (UFixed6);
    function maxCollateral() external view returns (UFixed6);
}
