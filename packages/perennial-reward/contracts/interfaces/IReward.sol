// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/attribute/interfaces/IFactory.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IReward is IOwnable, IERC20 {
    error RewardNotOperatorError();
    error RewardNotSupportedError();

    event RewardOperatorRegistered(IFactory indexed operator);

    function initialize() external;
    function register(IFactory factory) external;
    function mint(address to, uint256 amount) external;
    function redeem(uint256 amount) external;
    function operators(IFactory) external returns (bool);
}
