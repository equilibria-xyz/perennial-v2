// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/attribute/interfaces/IInstance.sol";
import "@equilibria/root/number/types/UFixed6.sol";
import "@equilibria/root/token/types/Token18.sol";
import "./IOracleProvider.sol";
import "../types/OracleVersion.sol";
import "../types/MarketParameter.sol";
import "../types/RiskParameter.sol";
import "../types/Version.sol";
import "../types/Local.sol";
import "../types/Global.sol";
import "../types/Position.sol";
import "../types/Checkpoint.sol";
import "../libs/VersionLib.sol";

interface IMarket is IInstance {
    struct MarketDefinition {
        Token18 token;
        IOracleProvider oracle;
    }

    struct Context {
        ProtocolParameter protocolParameter;
        MarketParameter marketParameter;
        RiskParameter riskParameter;
        OracleVersion latestOracleVersion;
        uint256 currentTimestamp;
        Global global;
        Local local;
        PositionContext latestPosition;
        OrderContext pending;
    }

    struct SettlementContext {
        Version latestVersion;
        Checkpoint latestCheckpoint;
        OracleVersion orderOracleVersion;
    }

    struct UpdateContext {
        bool operator;
        address liquidator;
        address referrer;
        UFixed6 referralFee;
        OrderContext order;
        PositionContext currentPosition;
    }

    struct PositionContext {
        Position global;
        Position local;
    }

    struct OrderContext {
        Order global;
        Order local;
    }

    event Updated(address indexed sender, address indexed account, uint256 version, UFixed6 newMaker, UFixed6 newLong, UFixed6 newShort, Fixed6 collateral, bool protect, address referrer);
    event OrderCreated(address indexed account, Order order);
    event PositionProcessed(uint256 orderId, Order order, VersionAccumulationResult accumulationResult);
    event AccountPositionProcessed(address indexed account, uint256 orderId, Order order, CheckpointAccumulationResult accumulationResult);
    event BeneficiaryUpdated(address newBeneficiary);
    event CoordinatorUpdated(address newCoordinator);
    event FeeClaimed(address indexed account, UFixed6 amount);
    event ExposureClaimed(address indexed account, Fixed6 amount);
    event ParameterUpdated(MarketParameter newParameter);
    event RiskParameterUpdated(RiskParameter newRiskParameter);
    event OracleUpdated(IOracleProvider newOracle);

    // sig: 0x0fe90964
    error MarketInsufficientLiquidityError();
    // sig: 0x00e2b6a8
    error MarketInsufficientMarginError();
    // sig: 0x442145e5
    error MarketInsufficientCollateralError();
    // sig: 0xba555da7
    error MarketProtectedError();
    // sig: 0x6ed43d8e
    error MarketMakerOverLimitError();
    // sig: 0x29ab4c44
    error MarketClosedError();
    // sig: 0x07732aee
    error MarketCollateralBelowLimitError();
    // sig: 0x5bdace60
    error MarketOperatorNotAllowedError();
    // sig: 0x8a68c1dc
    error MarketNotSingleSidedError();
    // sig: 0x736f9fda
    error MarketOverCloseError();
    // sig: 0x935bdc21
    error MarketExceedsPendingIdLimitError();
    // sig: 0x9bca0625
    error MarketNotCoordinatorError();
    // sig: 0xb602d086
    error MarketNotBeneficiaryError();
    // sig: 0x534f7fe6
    error MarketInvalidProtectionError();
    // sig: 0xab1e3a00
    error MarketStalePriceError();
    // sig: 0x15f9ae70
    error MarketEfficiencyUnderLimitError();
    // sig: 0x7302d51a
    error MarketInvalidMarketParameterError(uint256 code);
    // sig: 0xc5f0e98a
    error MarketInvalidRiskParameterError(uint256 code);
    // sig: 0x9dbdc5fd
    error MarketInvalidReferrerError();
    // sig: 0x5c5cb438
    error MarketSettleOnlyError();

    // sig: 0x2142bc27
    error GlobalStorageInvalidError();
    // sig: 0xc83d08ec
    error LocalStorageInvalidError();
    // sig: 0x7c53e926
    error MarketParameterStorageInvalidError();
    // sig: 0x98eb4898
    error PositionStorageLocalInvalidError();
    // sig: 0x7ecd083f
    error RiskParameterStorageInvalidError();
    // sig: 0xd2777e72
    error VersionStorageInvalidError();

    function initialize(MarketDefinition calldata definition_) external;
    function token() external view returns (Token18);
    function oracle() external view returns (IOracleProvider);
    function payoff() external view returns (address);
    function positions(address account) external view returns (Position memory);
    function pendingOrders(address account, uint256 id) external view returns (Order memory);
    function pendings(address account) external view returns (Order memory);
    function locals(address account) external view returns (Local memory);
    function versions(uint256 timestamp) external view returns (Version memory);
    function position() external view returns (Position memory);
    function pendingOrder(uint256 id) external view returns (Order memory);
    function pending() external view returns (Order memory);
    function global() external view returns (Global memory);
    function checkpoints(address account, uint256 id) external view returns (Checkpoint memory);
    function liquidators(address account, uint256 id) external view returns (address);
    function referrers(address account, uint256 id) external view returns (address);
    function settle(address account) external;
    function update(address account, UFixed6 newMaker, UFixed6 newLong, UFixed6 newShort, Fixed6 collateral, bool protect) external;
    function update(address account, UFixed6 newMaker, UFixed6 newLong, UFixed6 newShort, Fixed6 collateral, bool protect, address referrer) external;
    function parameter() external view returns (MarketParameter memory);
    function riskParameter() external view returns (RiskParameter memory);
    function updateOracle(IOracleProvider newOracle) external;
    function updateParameter(address newBeneficiary, address newCoordinator, MarketParameter memory newParameter) external;
    function updateRiskParameter(RiskParameter memory newRiskParameter) external;
    function claimFee() external;
}
