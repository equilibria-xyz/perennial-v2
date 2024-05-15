// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { Token18 } from "@equilibria/root/token/types/Token18.sol";
import { Token6 } from "@equilibria/root/token/types/Token6.sol";
import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { UFixed18, UFixed18Lib } from "@equilibria/root/number/types/UFixed18.sol";

import { IAccount } from "./interfaces/IAccount.sol";

// TODO: _Instance_ relies on owner of the factory, which doesn't apply here.
// _Ownable_ does not let someone other than the sender assign the owner.
// Consider making Ownable._updateOwner overridable to work around this.
contract Account is IAccount {
    address public owner;
    address public controller;

    constructor(address owner_, address controller_) {
        owner = owner_;
        controller = controller_;
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

    /// @inheritdoc IAccount
    function approveController(address token) external ownerOrController {
        uint8 tokenDecimals = _getTokenDecimals(token);
        if (tokenDecimals == 18) {
            Token18.wrap(token).approve(controller);
        }
        else if (tokenDecimals == 6)
             Token6.wrap(token).approve(controller);
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