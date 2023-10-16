// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@equilibria/root/attribute/Ownable.sol";
import "@equilibria/root/token/types/Token18.sol";
import "./interfaces/IReward.sol";

/// @title Reward
/// @dev Acts as an ERC20 wrapper for an upgradeable reward distribution system
/// @notice The liquidity incentivization reward abstraction contract
contract Reward is IReward, Ownable, ERC20 {
    Token18 public immutable underlying;
    UFixed18 public immutable exchangeRate;

    mapping(IFactory => bool) public operators;

    constructor(Token18 underlying_, UFixed18 exchangeRate_) ERC20("Reward", "") {
        underlying = underlying_;
        exchangeRate = exchangeRate_;
    }

    function initialize() external initializer(1) {
        __Ownable__initialize();
    }

    function register(IFactory factory) external onlyOwner {
        operators[factory] = true;
        emit RewardOperatorRegistered(factory);
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function redeem(uint256 amount) external {
        _burn(msg.sender, amount);
        underlying.push(msg.sender, UFixed18.wrap(amount).mul(exchangeRate));
    }

    function transfer(address to, uint256 amount) public override(IERC20, ERC20) onlyOperator returns (bool) {
        return super.transfer(to, amount);
    }

    function transferFrom(address, address, uint256) public pure override(IERC20, ERC20) returns (bool) {
        revert RewardNotSupportedError();
    }

    function approve(address, uint256) public pure override(IERC20, ERC20) returns (bool) {
        revert RewardNotSupportedError();
    }

    modifier onlyOperator {
        IInstance senderInstance = IInstance(msg.sender);
        IFactory senderFactory = senderInstance.factory();
        if (!senderFactory.instances(senderInstance)) revert RewardNotOperatorError();
        if (!operators[senderFactory]) revert RewardNotOperatorError();

        _;
    }
}
