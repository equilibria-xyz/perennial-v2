// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { IERC20, IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { Token18 } from "@equilibria/root/token/types/Token18.sol";
import { Token6 } from "@equilibria/root/token/types/Token6.sol";
import { Fixed6, Fixed6Lib } from "@equilibria/root/number/types/Fixed6.sol";
import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { UFixed18, UFixed18Lib } from "@equilibria/root/number/types/UFixed18.sol";

import { IAccount } from "./interfaces/IAccount.sol";
import { IMarket, Position} from "@equilibria/perennial-v2/contracts/interfaces/IMarket.sol";

import "hardhat/console.sol";

// TODO: _Instance_ relies on owner of the factory, which doesn't apply here.
// _Ownable_ does not let someone other than the sender assign the owner.
// Consider making Ownable._updateOwner overridable to work around this.
contract Account is IAccount{
    UFixed6 private constant UNCHANGED_POSITION = UFixed6Lib.MAX;

    address public owner;
    address public controller;

    constructor(address owner_, address controller_) {
        owner = owner_;
        controller = controller_;
    }

    /// @inheritdoc IAccount
    /// @dev Controller is initialized at construction and cannot be changed.
    function approveController(address token_) external ownerOrController {
        uint8 tokenDecimals = _getTokenDecimals(token_);
        if (tokenDecimals == 18)
            Token18.wrap(token_).approve(controller);
        else if (tokenDecimals == 6)
             Token6.wrap(token_).approve(controller);
        else // revert if token is not 18 or 6 decimals
            revert TokenNotSupportedError();
    }

    /// @inheritdoc IAccount
    /// @dev If Market ever supports non-18-decimal tokens, this method could be expanded 
    /// to handle them appropriately.
    function marketTransfer(IMarket market_, Fixed6 amount_) external ownerOrController {
        _marketTransfer18(market_, amount_);
    }

    /// @inheritdoc IAccount
    function withdraw(address token_, UFixed6 amount_) external ownerOrController {
        uint8 tokenDecimals = _getTokenDecimals(token_);
        if (tokenDecimals == 18)
            _withdraw18(Token18.wrap(token_), amount_);
        else if (tokenDecimals == 6)
            _withdraw6(Token6.wrap(token_), amount_);
        else // revert if token is not 18 or 6 decimals
            revert TokenNotSupportedError();
    }

    function _getTokenDecimals(address token_) private view returns (uint8 tokenDecimals_) {
        try IERC20Metadata(token_).decimals() returns (uint8 decimals_) {
            tokenDecimals_ = decimals_;
        } catch {
            // revert if token contract does not implement optional `decimals` method
            revert TokenNotSupportedError();
        }
    }

    function _marketTransfer18(IMarket market_, Fixed6 amount_) private {
        // implicitly approve the market to spend our collateral token
        IERC20 token = IERC20(Token18.unwrap(market_.token()));
        if (token.allowance(address(this), address(market_)) != type(uint256).max)
            market_.token().approve(address(market_));

        // handle magic number for full withdrawal
        if (amount_.eq(Fixed6Lib.MIN)){
            console.log("Account attempting full withdrawal");
            Position memory position = market_.positions(owner);
            // ensure user has a positive collateral balance to withdraw
            Fixed6 balance = market_.locals(owner).collateral;
            if (balance.sign() != 1) revert NoCollateral(address(market_));
            // ensure user has no position
            // TODO: consider gas cost of this check and whether it is worth the revert reason
            if (!(position.maker.isZero() && position.long.isZero() && position.short.isZero()))
                revert PositionNotZero(address(market_));
            // TODO: Assuming we don't need to check pending orders here because the withdrawal would fail regardless.
            // TODO: could save some gas by creating an efficient Fixed6.mulNegOne method
            amount_ = balance.mul(Fixed6Lib.NEG_ONE);
            console.log("Account set withdrawal amount to %s", UFixed6.unwrap(amount_.abs()));
        }

        // TODO: handle magic number for full deposit?

        // pass magic numbers to avoid changing position; market will pull/push collateral from/to this contract
        console.log("Account attempting to update market %s with collateral %s", address(market_), UFixed6.unwrap(amount_.abs()));
        market_.update(owner, UNCHANGED_POSITION, UNCHANGED_POSITION, UNCHANGED_POSITION, amount_, false);
    }

    function _withdraw18(Token18 token_, UFixed6 amount_) private {
        // if user requested max withdrawal, withdraw the balance, otherwise convert amount to token precision
        UFixed18 amount = amount_.eq(UFixed6Lib.MAX) ? token_.balanceOf() : UFixed18Lib.from(amount_);
        // send funds back to the owner
        token_.push(owner, amount);
    }

    function _withdraw6(Token6 token_, UFixed6 amount_) private {
        // if user requested max withdrawal, withdraw the balance, otherwise withdraw specified amount
        UFixed6 amount = amount_.eq(UFixed6Lib.MAX) ? token_.balanceOf() : amount_;
        // send funds back to the owner
        token_.push(owner, amount);
    }

    /// @dev Reverts if not called by the owner of the collateral account, or the collateral account controller
    modifier ownerOrController {
        if (msg.sender != owner && msg.sender != controller) revert NotAuthorizedError(msg.sender);
        _;
    }
}