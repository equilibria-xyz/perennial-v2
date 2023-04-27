// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root-v2/contracts/IOwnable.sol";
import "@equilibria/root-v2/contracts/UFixed6.sol";
import "@equilibria/root/token/types/Token18.sol";
import "@equilibria/perennial-v2-oracle/contracts/IOracleProvider.sol";
import "@equilibria/perennial-v2-oracle/contracts/types/OracleVersion.sol";
import "../types/Version.sol";
import "../types/Account.sol";
import "../types/Fee.sol";
import "../types/Order.sol";

interface IMarket is IOwnable {
    struct MarketDefinition {
        string name;
        string symbol;
        Token18 token;
        Token18 reward;
    }

    struct CurrentContext {
        ProtocolParameter protocolParameter;
        MarketParameter marketParameter;
        OracleVersion currentOracleVersion;
        Version version;
        Order pendingOrder;
        Order order;
        Fee fee;
        Account account;
        Order accountOrder;
        Order accountPendingOrder;

        uint256 gasCounter;
        string gasCounterMessage;
    }

    event Settle(uint256 preVersion, uint256 toVersion);
    event AccountSettle(address indexed account, uint256 preVersion, uint256 toVersion);
    event Updated(address indexed account, uint256 version, UFixed6 newMaker, UFixed6 newLong, UFixed6 newShort, Fixed6 newCollateral);
    event Liquidation(address indexed account, address liquidator, UFixed6 liquidationReward);
    event FeeSettled(UFixed6 protocolFeeAmount, UFixed6 marketFeeAmount);
    event CollateralSettled(address indexed account, Fixed6 amount, UFixed6 newShortfall);
    event TreasuryUpdated(address newTreasury);
    event FeeClaimed(address indexed treasury, UFixed6 feeAmount);
    event RewardClaimed(address indexed account, UFixed6 rewardAmount);
    event ParameterUpdated(MarketParameter newParameter);

    error MarketInsufficientLiquidityError();
    error MarketInsufficientCollateralError();
    error MarketInLiquidationError();
    error MarketInDebtError();
    error MarketMakerOverLimitError();
    error MarketOracleBootstrappingError();
    error MarketInvalidOracle();
    error MarketPausedError();
    error MarketClosedError();
    error MarketCollateralUnderLimitError();
    error MarketNotTreasuryError();
    error PayoffProviderInvalidOracle();
    error PayoffProviderInvalidPayoffDefinitionError();
    error MarketOperatorNotAllowed();
    error MarketNotSingleSidedError();

    function initialize(MarketDefinition calldata definition_, MarketParameter calldata parameter_) external;
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function token() external view returns (Token18);
    function reward() external view returns (Token18);
    function treasury() external view returns (address);
    function orders(address account) external view returns (Order memory);
    function pendingOrders(address account) external view returns (Order memory);
    function accounts(address account) external view returns (Account memory);
    function versions(uint256 oracleVersion) external view returns (Version memory);
    function pendingOrder() external view returns (Order memory);
    function order() external view returns (Order memory);
    function fee() external view returns (Fee memory);
    function settle(address account) external;
    function update(address account, UFixed6 newMaker, UFixed6 newLong, UFixed6 newShort, Fixed6 newCollateral) external;
    function updateTreasury(address newTreasury) external;
    function parameter() external view returns (MarketParameter memory);
    function updateParameter(MarketParameter memory newParameter) external;
}
