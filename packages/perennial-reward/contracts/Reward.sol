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

    /// @dev The underlying token that is distributed as a reward
    Token18 public immutable underlying;

    /// @dev The exchange rate between the underlying token and the reward token
    UFixed18 public immutable exchangeRate;

    /// @dev Mapping of which factory's instances are authorized to transfer the reward token
    mapping(IFactory => bool) public operators;

    /// @notice Constructs the contract
    /// @param underlying_ The underlying token that is distributed as a reward
    /// @param exchangeRate_ The exchange rate between the underlying token and the reward token
    constructor(Token18 underlying_, UFixed18 exchangeRate_) ERC20("Reward", "") {
        underlying = underlying_;
        exchangeRate = exchangeRate_;
    }

    /// @notice Initializes the contract state
    function initialize() external initializer(1) {
        __Ownable__initialize();
    }

    /// @notice Registers a factory as an operator
    /// @param factory The factory to register
    function register(IFactory factory) external onlyOwner {
        operators[factory] = true;
        emit RewardOperatorRegistered(factory);
    }

    /// @notice Mints new reward tokens to the specified address
    /// @param to The address to mint to
    /// @param amount The amount to mint
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /// @notice Redeems reward tokens for the underlying tokens
    /// @param amount The amount to redeem
    function redeem(uint256 amount) external {
        _burn(msg.sender, amount);
        underlying.push(msg.sender, UFixed18.wrap(amount).mul(exchangeRate));
    }

    /// @dev ERC20 transfer overridden to only allow operators to transfer
    function transfer(address to, uint256 amount) public override(IERC20, ERC20) onlyOperator returns (bool) {
        return super.transfer(to, amount);
    }

    /// @dev ERC20 transferFrom overridden to be disabled
    function transferFrom(address, address, uint256) public pure override(IERC20, ERC20) returns (bool) {
        revert RewardNotSupportedError();
    }

    /// @dev ERC20 approve overridden to be disabled
    function approve(address, uint256) public pure override(IERC20, ERC20) returns (bool) {
        revert RewardNotSupportedError();
    }

    /// @dev Only allow instances of authorized factories to call
    modifier onlyOperator {
        IInstance senderInstance = IInstance(msg.sender);
        IFactory senderFactory = senderInstance.factory();
        if (!senderFactory.instances(senderInstance)) revert RewardNotOperatorError();
        if (!operators[senderFactory]) revert RewardNotOperatorError();

        _;
    }
}
