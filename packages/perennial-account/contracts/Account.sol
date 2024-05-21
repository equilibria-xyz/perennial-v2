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
    function deposit(UFixed6 amount, bool wrap) external {
        if (wrap) {
            USDC.pull(msg.sender, amount);
            _wrap(UFixed18Lib.from(amount));
        } else {
            DSU.pull(msg.sender, UFixed18Lib.from(amount));
        }
    }

    // TODO: add a wrap parameter, support wrapping USDC balance to DSU when amount > DSU balance
    /// @inheritdoc IAccount
    /// @dev If Market ever supports non-18-decimal tokens, this method could be expanded 
    /// to handle them appropriately.
    function marketTransfer(IMarket market, Fixed6 amount) external ownerOrController {
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

    /// @inheritdoc IAccount
    function withdraw(UFixed6 amount, bool unwrap) external ownerOrController {
        UFixed6 usdcBalance = USDC.balanceOf();
        if (unwrap && usdcBalance.lt(amount)) {
            UFixed18 unwrapAmount;
            if (amount.eq(UFixed6Lib.MAX))
                unwrapAmount = DSU.balanceOf();
            else
                unwrapAmount = UFixed18Lib.from(amount.sub(usdcBalance)).min(DSU.balanceOf());
            // console.log('Account::withdraw attempting to unwrap %s DSU', UFixed18.unwrap(unwrapAmount));
            _unwrap(unwrapAmount);
        }
        UFixed6 pushAmount = amount.eq(UFixed6Lib.MAX) ? USDC.balanceOf() : amount;
        // console.log('Account::withdraw attempting to push %s USDC; balance is %s', 
        //     UFixed6.unwrap(pushAmount),
        //     UFixed6.unwrap(USDC.balanceOf())
        // );
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