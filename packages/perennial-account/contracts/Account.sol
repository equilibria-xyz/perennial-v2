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
contract Account is IAccount{
    address public owner;
    address public controller;

    constructor(address owner_, address controller_) {
        owner = owner_;
        controller = controller_;
    }

    /// @inheritdoc IAccount
    function withdraw(address token_, UFixed6 amount_) external ownerOrController {
        uint8 tokenDecimals;
        try IERC20Metadata(token_).decimals() returns (uint8 tokenDecimals_) {
            tokenDecimals = tokenDecimals_;
        } catch {
            // revert if token contract does not implement optional `decimals` method
            revert TokenNotSupportedError();
        }
        if (tokenDecimals == 18)
            return _withdraw18(Token18.wrap(token_), amount_);
        else if (tokenDecimals == 6)
            return _withdraw6(Token6.wrap(token_), amount_);
        else // revert if token is not 18 or 6 decimals
            revert TokenNotSupportedError();
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