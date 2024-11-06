// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { IEmptySetReserve } from "@equilibria/emptyset-batcher/interfaces/IEmptySetReserve.sol";
import { Instance } from "@equilibria/root/attribute/Instance.sol";
import { Fixed6, Fixed6Lib } from "@equilibria/root/number/types/Fixed6.sol";
import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { UFixed18, UFixed18Lib } from "@equilibria/root/number/types/UFixed18.sol";
import { Token6 } from "@equilibria/root/token/types/Token6.sol";
import { Token18 } from "@equilibria/root/token/types/Token18.sol";

import { IAccount } from "./interfaces/IAccount.sol";
import { IMarket, Position } from "@perennial/v2-core/contracts/interfaces/IMarket.sol";

/// @title Account
/// @notice Collateral Accounts allow users to manage collateral across Perennial markets
contract Account is IAccount, Instance {
    UFixed6 private constant UNCHANGED_POSITION = UFixed6Lib.MAX;

    /// @dev EOA of the user who owns this collateral account
    address public owner;

    /// @dev USDC stablecoin address
    Token6 public immutable USDC; // solhint-disable-line var-name-mixedcase

    /// @dev DSU address
    Token18 public immutable DSU; // solhint-disable-line var-name-mixedcase

    /// @dev DSU Reserve address
    IEmptySetReserve public immutable reserve;

    /// @dev Construct collateral account and set approvals for controller and DSU reserve
    /// @param usdc_ USDC stablecoin
    /// @param dsu_ Digital Standard Unit stablecoin
    /// @param reserve_ DSU SimpleReserve contract, used for wrapping/unwrapping USDC to/from DSU
    constructor(Token6 usdc_, Token18 dsu_, IEmptySetReserve reserve_) {
        USDC = usdc_;
        DSU = dsu_;
        reserve = reserve_;
    }

    /// @inheritdoc IAccount
    function initialize(address owner_) external initializer(1) {
        __Instance__initialize();
        owner = owner_;

        // approve the Controller to interact with this account's DSU
        DSU.approve(address(factory()));

        // approve DSU facilities to wrap and unwrap USDC for this account
        DSU.approve(address(reserve));
        USDC.approve(address(reserve));
    }

    /// @inheritdoc IAccount
    function deposit(UFixed6 amount) external {
        USDC.pull(msg.sender, amount);
    }

    /// @inheritdoc IAccount
    function marketTransfer(IMarket market, Fixed6 amount) external ownerOrController {
        // implicitly approve this market to spend our DSU
        DSU.approve(address(market));

        // if account does not have enough DSU for the deposit, wrap everything
         if (amount.gt(Fixed6Lib.ZERO))
            wrapIfNecessary(UFixed18Lib.from(amount.abs()), true);

        // pass magic numbers to avoid changing position; market will pull/push collateral from/to this contract
        market.update(owner, UNCHANGED_POSITION, UNCHANGED_POSITION, UNCHANGED_POSITION, amount, false);
    }

    /// @inheritdoc IAccount
    function withdraw(UFixed6 amount, bool shouldUnwrap) external ownerOrController {
        UFixed6 usdcBalance = USDC.balanceOf();
        if (shouldUnwrap && usdcBalance.lt(amount)) {
            UFixed18 unwrapAmount = amount.eq(UFixed6Lib.MAX) ?
                DSU.balanceOf() :
                UFixed18Lib.from(amount.sub(usdcBalance)).min(DSU.balanceOf());
            unwrap(unwrapAmount);
        }
        UFixed6 pushAmount = amount.eq(UFixed6Lib.MAX) ? USDC.balanceOf() : amount;
        USDC.push(owner, pushAmount);
    }

    /// @inheritdoc IAccount
    function wrap(UFixed18 amount) public ownerOrController {
        reserve.mint(amount);
    }

    /// @inheritdoc IAccount
    function wrapIfNecessary(UFixed18 amount, bool wrapAll) public ownerOrController {
        if (DSU.balanceOf().lt(amount)) {
            UFixed6 usdcBalance = USDC.balanceOf();
            if (!usdcBalance.eq(UFixed6Lib.ZERO))
                wrap(wrapAll ? UFixed18Lib.from(usdcBalance) : amount);
        }
    }

    /// @inheritdoc IAccount
    function unwrap(UFixed18 amount) public ownerOrController {
        reserve.redeem(amount);
    }

    /// @dev Reverts if not called by the owner of the collateral account, or the collateral account controller
    modifier ownerOrController {
        if (msg.sender != owner && msg.sender != address(factory())) revert AccountNotAuthorizedError();
        _;
    }
}
