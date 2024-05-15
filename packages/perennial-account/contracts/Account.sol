// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { Token18 } from "@equilibria/root/token/types/Token18.sol";
import { Token6 } from "@equilibria/root/token/types/Token6.sol";
import { Fixed6, Fixed6Lib } from "@equilibria/root/number/types/Fixed6.sol";
import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { UFixed18, UFixed18Lib } from "@equilibria/root/number/types/UFixed18.sol";

import { IAccount } from "./interfaces/IAccount.sol";
import { IMarket, Position } from "@equilibria/perennial-v2/contracts/interfaces/IMarket.sol";

/// @title Account
/// @notice Collateral Accounts allow users to manage collateral across Perennial markets
contract Account is IAccount {
    UFixed6 private constant UNCHANGED_POSITION = UFixed6Lib.MAX;

    address public owner;
    address public controller;

    constructor(address owner_, address controller_) {
        owner = owner_;
        controller = controller_;
    }

    /// @inheritdoc IAccount
    /// @dev Controller is initialized at construction and cannot be changed.
    function approveController(address token) external ownerOrController {
        uint8 tokenDecimals = _getTokenDecimals(token);
        if (tokenDecimals == 18)
            Token18.wrap(token).approve(controller);
        else if (tokenDecimals == 6)
            Token6.wrap(token).approve(controller);
        else // revert if token is not 18 or 6 decimals
            revert TokenNotSupportedError();
    }

    /// @inheritdoc IAccount
    /// @dev If Market ever supports non-18-decimal tokens, this method could be expanded 
    /// to handle them appropriately.
    function marketTransfer(IMarket market, Fixed6 amount) external ownerOrController {
        _marketTransfer18(market, amount);
    }

    /// @inheritdoc IAccount
    function withdraw(address token, UFixed6 amount) external ownerOrController {
        uint8 tokenDecimals = _getTokenDecimals(token);
        if (tokenDecimals == 18)
            _withdraw18(Token18.wrap(token), amount);
        else if (tokenDecimals == 6)
            _withdraw6(Token6.wrap(token), amount);
        else // revert if token is not 18 or 6 decimals
            revert TokenNotSupportedError();
    }

    function _getTokenDecimals(address token) private view returns (uint8 tokenDecimals) {
        try IERC20Metadata(token).decimals() returns (uint8 decimals) {
            tokenDecimals = decimals;
        } catch {
            // revert if token contract does not implement optional `decimals` method
            revert TokenNotSupportedError();
        }
    }

    function _marketTransfer18(IMarket market, Fixed6 amount) private {
        // implicitly approve the market to spend our collateral token
        IERC20Metadata token = IERC20Metadata(Token18.unwrap(market.token()));
        if (token.allowance(address(this), address(market)) != type(uint256).max)
            market.token().approve(address(market));

        // handle magic number for full withdrawal
        if (amount.eq(Fixed6Lib.MIN)){
            // ensure user has a positive collateral balance to withdraw
            Fixed6 balance = market.locals(owner).collateral;
            if (balance.sign() != 1) revert NoCollateral(address(market));
            // ensure user has no position
            // TODO: save some gas by creating an efficient Fixed6.negative method
            amount = balance.mul(Fixed6Lib.NEG_ONE);
        // handle magic number for full deposit
        } else if (amount.eq(Fixed6Lib.MAX)){
            UFixed18 balance = UFixed18.wrap(token.balanceOf(address(this)));
            amount = Fixed6Lib.from(UFixed6Lib.from(balance));
        }

        // pass magic numbers to avoid changing position; market will pull/push collateral from/to this contract
        // console.log("Account attempting to update market %s with collateral %s", address(market_), UFixed6.unwrap(amount_.abs()));
        market.update(owner, UNCHANGED_POSITION, UNCHANGED_POSITION, UNCHANGED_POSITION, amount, false);
    }

    function _withdraw18(Token18 token, UFixed6 amount) private {
        // if user requested max withdrawal, withdraw the balance, otherwise convert amount to token precision
        UFixed18 withdrawal = amount.eq(UFixed6Lib.MAX) ? token.balanceOf() : UFixed18Lib.from(amount);
        // send funds back to the owner
        token.push(owner, withdrawal);
    }

    function _withdraw6(Token6 token, UFixed6 amount) private {
        // if user requested max withdrawal, withdraw the balance, otherwise withdraw specified amount
        UFixed6 withdrawal = amount.eq(UFixed6Lib.MAX) ? token.balanceOf() : amount;
        // send funds back to the owner
        token.push(owner, withdrawal);
    }

    /// @dev Reverts if not called by the owner of the collateral account, or the collateral account controller
    modifier ownerOrController {
        if (msg.sender != owner && msg.sender != controller) revert NotAuthorizedError(msg.sender);
        _;
    }
}