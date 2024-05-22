// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { IEmptySetReserve } from "@equilibria/emptyset-batcher/interfaces/IEmptySetReserve.sol";
import { Token6 } from "@equilibria/root/token/types/Token6.sol";
import { Token18 } from "@equilibria/root/token/types/Token18.sol";
import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { UFixed18, UFixed18Lib } from "@equilibria/root/number/types/UFixed18.sol";

import { IAccount } from "./interfaces/IAccount.sol";

/// @title Account
/// @notice Collateral Accounts allow users to manage collateral across Perennial markets
contract Account is IAccount {
    /// @dev EOA of the user who owns this collateral account
    address public immutable owner;

    /// @dev address of the Controller contract, used for checking permissions
    address public immutable controller;

    /// @dev USDC stablecoin address
    Token6 public immutable USDC; // solhint-disable-line var-name-mixedcase

    /// @dev DSU address
    Token18 public immutable DSU; // solhint-disable-line var-name-mixedcase

    /// @dev DSU Reserve address
    IEmptySetReserve public immutable reserve;

    constructor(
        address owner_,
        address controller_,
        Token6 usdc_,
        Token18 dsu_,
        IEmptySetReserve reserve_
    ) {
        owner = owner_;
        controller = controller_;
        USDC = usdc_;
        DSU = dsu_;
        reserve = reserve_;

        dsu_.approve(controller_);

        // approve DSU facilities to wrap and unwrap USDC for this account
        dsu_.approve(address(reserve));
        usdc_.approve(address(reserve));
    }

    /// @inheritdoc IAccount
    function deposit(UFixed6 amount) external {
        USDC.pull(msg.sender, amount);
    }

    /// @inheritdoc IAccount
    function withdraw(UFixed6 amount, bool unwrap) external ownerOrController {
        UFixed6 usdcBalance = USDC.balanceOf();
        if (unwrap && usdcBalance.lt(amount)) {
            UFixed18 unwrapAmount = amount.eq(UFixed6Lib.MAX) ?
                DSU.balanceOf() :
                UFixed18Lib.from(amount.sub(usdcBalance)).min(DSU.balanceOf());
            _unwrap(unwrapAmount);
        }
        UFixed6 pushAmount = amount.eq(UFixed6Lib.MAX) ? USDC.balanceOf() : amount;
        USDC.push(owner, pushAmount);
    }

    /// @notice Helper function to wrap `amount` USDC from `address(this)` into DSU using the reserve
    /// @param amount Amount of USDC to wrap
    function _wrap(UFixed18 amount) internal {
        reserve.mint(amount);
    }

    /// @notice Helper function to unwrap `amount` DSU into USDC and send to `receiver`
    /// @param amount Amount of DSU to unwrap
    function _unwrap(UFixed18 amount) internal {
        reserve.redeem(amount);
    }

    /// @dev Reverts if not called by the owner of the collateral account, or the collateral account controller
    modifier ownerOrController {
        if (msg.sender != owner && msg.sender != controller) revert NotAuthorizedError(msg.sender);
        _;
    }
}