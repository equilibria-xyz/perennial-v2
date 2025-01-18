// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { IInstance } from "@equilibria/root/attribute/interfaces/IInstance.sol";
import { UFixed6 } from "@equilibria/root/number/types/UFixed6.sol";
import { Fixed6 } from "@equilibria/root/number/types/Fixed6.sol";
import { Token18 } from "@equilibria/root/token/types/Token18.sol";
import { IOracleProvider } from "./IOracleProvider.sol";
import { OracleVersion } from "../types/OracleVersion.sol";
import { MarketParameter } from "../types/MarketParameter.sol";
import { RiskParameter } from "../types/RiskParameter.sol";
import { Version } from "../types/Version.sol";
import { Local } from "../types/Local.sol";
import { Global } from "../types/Global.sol";
import { Position } from "../types/Position.sol";
import { Checkpoint } from "../types/Checkpoint.sol";
import { Order } from "../types/Order.sol";
import { Guarantee } from "../types/Guarantee.sol";
import { Intent } from "../types/Intent.sol";
import { Take } from "../types/Take.sol";
import { VersionAccumulationResult } from "../libs/VersionLib.sol";
import { CheckpointAccumulationResult } from "../libs/CheckpointLib.sol";

interface IMarket is IInstance {
    struct MarketDefinition {
        Token18 token;
        IOracleProvider oracle;
    }

    struct Context {
        address account;
        MarketParameter marketParameter;
        RiskParameter riskParameter;
        OracleVersion latestOracleVersion;
        uint256 currentTimestamp;
        Global global;
        Local local;
        Position latestPositionGlobal;
        Position latestPositionLocal;
        Order pendingGlobal;
        Order pendingLocal;
    }

    struct SettlementContext {
        Version latestVersion;
        Checkpoint latestCheckpoint;
        OracleVersion orderOracleVersion;
    }

    struct UpdateContext {
        bool operator;
        bool signer;
        address liquidator;
        address orderReferrer;
        UFixed6 orderReferralFee;
        address guaranteeReferrer;
        UFixed6 guaranteeReferralFee;
        Order orderGlobal;
        Order orderLocal;
        Position currentPositionGlobal;
        Position currentPositionLocal;
        Guarantee guaranteeGlobal;
        Guarantee guaranteeLocal;
        UFixed6 collateralization;
    }

    event OrderCreated(address indexed account, Order order, Guarantee guarantee, address liquidator, address orderReferrer, address guaranteeReferrer);
    event PositionProcessed(uint256 orderId, Order order, VersionAccumulationResult accumulationResult);
    event AccountPositionProcessed(address indexed account, uint256 orderId, Order order, CheckpointAccumulationResult accumulationResult);
    event BeneficiaryUpdated(address newBeneficiary);
    event CoordinatorUpdated(address newCoordinator);
    /// @notice Fee earned by an account was transferred from market to a receiver
    /// @param account User who earned the fee
    /// @param receiver Delegated operator of the account, or the account itself
    /// @param amount Collateral transferred from market to receiver
    event FeeClaimed(address indexed account, address indexed receiver, UFixed6 amount);
    event ExposureClaimed(address indexed account, Fixed6 amount);
    event ParameterUpdated(MarketParameter newParameter);
    event RiskParameterUpdated(RiskParameter newRiskParameter);

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
    // sig: 0x3222db45
    /// @custom:error Sender is not authorized to interact with markets on behalf of the account
    error MarketNotOperatorError();
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
    // sig: 0x1e9d2296
    error MarketInvalidIntentFeeError();
    // sig: 0xaf5dfc8f
    error MarketIntentPriceDeviationError();

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
    function beneficiary() external view returns (address);
    function coordinator() external view returns (address);
    function positions(address account) external view returns (Position memory);
    function pendingOrders(address account, uint256 id) external view returns (Order memory);
    function guarantees(address account, uint256 id) external view returns (Guarantee memory);
    function pendings(address account) external view returns (Order memory);
    function locals(address account) external view returns (Local memory);
    function versions(uint256 timestamp) external view returns (Version memory);
    function position() external view returns (Position memory);
    function pendingOrder(uint256 id) external view returns (Order memory);
    function guarantee(uint256 id) external view returns (Guarantee memory);
    function pending() external view returns (Order memory);
    function global() external view returns (Global memory);
    function checkpoints(address account, uint256 version) external view returns (Checkpoint memory);
    function liquidators(address account, uint256 id) external view returns (address);
    function orderReferrers(address account, uint256 id) external view returns (address);
    function guaranteeReferrers(address account, uint256 id) external view returns (address);
    function settle(address account) external;
    function update(address account, Intent calldata intent, bytes memory signature) external;
    function update(Take calldata update, bytes memory signature) external;
    function update(address account, Fixed6 amount, address referrer) external;
    function update(address account, Fixed6 amount, Fixed6 collateral, address referrer) external;
    function update(address account, Fixed6 makerAmount, Fixed6 takerAmount, Fixed6 collateral, address referrer) external;
    function update(address account, UFixed6 newMaker, UFixed6 newLong, UFixed6 newShort, Fixed6 collateral, bool protect) external;
    function update(address account, UFixed6 newMaker, UFixed6 newLong, UFixed6 newShort, Fixed6 collateral, bool protect, address referrer) external;
    function parameter() external view returns (MarketParameter memory);
    function riskParameter() external view returns (RiskParameter memory);
    function updateBeneficiary(address newBeneficiary) external;
    function updateCoordinator(address newCoordinator) external;
    function updateParameter(MarketParameter memory newParameter) external;
    function updateRiskParameter(RiskParameter memory newRiskParameter) external;
    function claimFee(address account) external returns (UFixed6);
}
