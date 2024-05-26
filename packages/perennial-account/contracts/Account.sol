// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { IEmptySetReserve } from "@equilibria/emptyset-batcher/interfaces/IEmptySetReserve.sol";
import { Token6 } from "@equilibria/root/token/types/Token6.sol";
import { Token18 } from "@equilibria/root/token/types/Token18.sol";
import { Fixed6, Fixed6Lib } from "@equilibria/root/number/types/Fixed6.sol";
import { Token6 } from "@equilibria/root/token/types/Token6.sol";
import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { UFixed18, UFixed18Lib } from "@equilibria/root/number/types/UFixed18.sol";

import { IAccount } from "./interfaces/IAccount.sol";
import { IMarket, Position } from "@equilibria/perennial-v2/contracts/interfaces/IMarket.sol";

/// @title Account
/// @notice Collateral Accounts allow users to manage collateral across Perennial markets
contract Account is IAccount {
    UFixed6 private constant UNCHANGED_POSITION = UFixed6Lib.MAX;

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

    /// @dev Construct collateral account and set approvals for controller and DSU reserve
    /// @param owner_ EOA of the user for whom this collateral account belongs
    /// @param controller_ Controller contract used for setting approvals and checking permissions
    /// @param usdc_ USDC stablecoin
    /// @param dsu_ Digital Standard Unit stablecoin
    /// @param reserve_ DSU SimpleReserve contract, used for wrapping/unwrapping USDC to/from DSU
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
    function marketTransfer(IMarket market, Fixed6 amount) external ownerOrController {
        // implicitly approve this market to spend our DSU
        uint256 allowance = IERC20Metadata(Token18.unwrap(DSU)).allowance(address(this), address(market));
        if (allowance != type(uint256).max)
            DSU.approve(address(market));

        // handle magic number for full withdrawal
        if (amount.eq(Fixed6Lib.MIN)){
            // ensure user has a positive collateral balance to withdraw
            Fixed6 balance = market.locals(owner).collateral;
            if (balance.sign() != 1) revert AccountNoCollateral(address(market));
            // ensure user has no position
            amount = balance.mul(Fixed6Lib.NEG_ONE);

        // handle magic number for full deposit
        } else if (amount.eq(Fixed6Lib.MAX)){
            UFixed6 usdcBalance = USDC.balanceOf();
            if (!usdcBalance.eq(UFixed6Lib.ZERO))
                wrap(UFixed18Lib.from(usdcBalance));
            UFixed18 balance = DSU.balanceOf();
            amount = Fixed6Lib.from(UFixed6Lib.from(balance));

        // if account does not have enough DSU for the deposit, wrap everything
        } else if (amount.gt(Fixed6Lib.ZERO)) {
            UFixed6 dsuBalance6 = UFixed6Lib.from(DSU.balanceOf());
            if (UFixed6Lib.from(amount).gt(dsuBalance6)) {
                UFixed6 usdcBalance = USDC.balanceOf();
                if (!usdcBalance.eq(UFixed6Lib.ZERO))
                    wrap(UFixed18Lib.from(usdcBalance));
            }
        }

        // pass magic numbers to avoid changing position; market will pull/push collateral from/to this contract
        market.update(owner, UNCHANGED_POSITION, UNCHANGED_POSITION, UNCHANGED_POSITION, amount, false);
    }

    /// @inheritdoc IAccount
    function withdraw(UFixed6 amount, bool unwrap_) external ownerOrController {
        UFixed6 usdcBalance = USDC.balanceOf();
        if (unwrap_ && usdcBalance.lt(amount)) {
            UFixed18 unwrapAmount = amount.eq(UFixed6Lib.MAX) ?
                DSU.balanceOf() :
                UFixed18Lib.from(amount.sub(usdcBalance)).min(DSU.balanceOf());
            unwrap(unwrapAmount);
        }
        UFixed6 pushAmount = amount.eq(UFixed6Lib.MAX) ? USDC.balanceOf() : amount;
        USDC.push(owner, pushAmount);
    }

    /// @notice Helper function to wrap `amount` USDC from `address(this)` into DSU using the reserve
    /// @param amount Amount of USDC to wrap
    function wrap(UFixed18 amount) public ownerOrController {
        reserve.mint(amount);
    }

    /// @notice Helper function to unwrap `amount` DSU into USDC and send to `receiver`
    /// @param amount Amount of DSU to unwrap
    function unwrap(UFixed18 amount) public ownerOrController {
        reserve.redeem(amount);
    }

    /// @dev Reverts if not called by the owner of the collateral account, or the collateral account controller
    modifier ownerOrController {
        if (msg.sender != owner && msg.sender != controller) revert AccountNotAuthorizedError();
        _;
    }
}