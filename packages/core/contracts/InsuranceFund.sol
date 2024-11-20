// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import { Ownable } from "@equilibria/root/attribute/Ownable.sol";
import { Token18 } from "@equilibria/root/token/types/Token18.sol";
import { UFixed18 } from "@equilibria/root/number/types/UFixed18.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { IInsuranceFund } from "./interfaces/IInsuranceFund.sol";
import { IMarket } from "./interfaces/IMarket.sol";

/// @title InsuranceFund
/// @notice This contract manages the protocol fee and shortfalls for markets.
contract InsuranceFund is IInsuranceFund, Ownable {

    /// @notice The address of the market factory owner.
    address public marketFactoryOwner;

    /// @notice The address of DSU token
    Token18 public DSU;

    /**
     * @notice Initializes the InsuranceFund contract.
     * @param _marketFactoryOwner The address of the market factory owner.
     * @param _token The address of the DSU token.
     */
    function initialize(address _marketFactoryOwner, Token18 _token) external initializer(1) {
        __Ownable__initialize();
        marketFactoryOwner = _marketFactoryOwner;
        DSU = _token;
    }

    /**
     * @notice Claims fees from a market.
     * @param market The address of the market from which to claim protocol fees.
     */
    function claimFees(address market) external {
        if (market == address(0)) revert InsuranceFundInvalidAddress();
        IMarket(market).claimFee(marketFactoryOwner);
    }

    /**
     * @notice Resolves any shortfall in a market.
     * @param market The address of the market for which to resolve the shortfall.
     * @dev This function can only be called by the owner.
     */
    function resolveShortfall(address market) external onlyOwner {
        if (market == address(0)) revert InsuranceFundInvalidAddress();

        if (IERC20(Token18.unwrap(DSU)).allowance(address(this), market) != type(uint256).max) {
            DSU.approve(market);
        }
        IMarket(market).claimExposure();
    }

    /**
     * @notice Sends DSU tokens to a market contract.
     * @param market The address of the market contract to send DSU tokens to.
     * @param amount The amount of DSU tokens to send.
     */
    function sendDSUToMarket(address market, UFixed18 amount) external onlyOwner {
        if (market == address(0)) revert InsuranceFundInvalidAddress();
        if (amount.isZero()) revert InsuranceFundInvalidAmount();
        DSU.push(market, amount);
    }

    /**
     * @notice Withdraws DSU tokens from the contract.
     * @param amount The amount of DSU tokens to withdraw.
     */
    function withdrawDSU(UFixed18 amount) external onlyOwner {
        if (amount.isZero() || DSU.balanceOf(address(this)).lt(amount)) revert InsuranceFundInvalidAmount();
        DSU.push(msg.sender, amount);
    }
}
