// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root-v2/contracts/IInstance.sol";
import "@equilibria/root/number/types/UFixed6.sol";
import "@equilibria/root/token/types/Token18.sol";
import "@equilibria/perennial-v2-oracle/contracts/interfaces/IOracleProvider.sol";
import "@equilibria/perennial-v2-payoff/contracts/interfaces/IPayoffProvider.sol";
import "@equilibria/perennial-v2-oracle/contracts/types/OracleVersion.sol";
import "../types/MarketParameter.sol";
import "../types/RiskParameter.sol";
import "../types/Version.sol";
import "../types/Local.sol";
import "../types/Global.sol";
import "../types/Position.sol";

interface IMarket is IInstance {
    struct MarketDefinition {
        string name;
        string symbol;
        Token18 token;
        Token18 reward;
        IOracleProvider oracle;
        IPayoffProvider payoff;
    }

    struct CurrentContext {
        ProtocolParameter protocolParameter;
        MarketParameter marketParameter;
        RiskParameter riskParameter;
        uint256 currentTimestamp;
        OracleVersion latestVersion;
        OracleVersion positionVersion;
        Position pendingPosition;
        Position position;
        Global global;
        Local local;
        Position accountPosition;
        Position accountPendingPosition;

        uint256 gasCounter;
        string gasCounterMessage;
    }

    event Settle(uint256 preVersion, uint256 toVersion);
    event AccountSettle(address indexed account, uint256 preVersion, uint256 toVersion);
    event Updated(address indexed account, uint256 version, UFixed6 newMaker, UFixed6 newLong, UFixed6 newShort, Fixed6 collateral);
    event Liquidation(address indexed account, address liquidator, UFixed6 liquidationFee);
    event FeeSettled(UFixed6 protocolFeeAmount, UFixed6 marketFeeAmount);
    event CollateralSettled(address indexed account, Fixed6 amount, UFixed6 newShortfall);
    event TreasuryUpdated(address newTreasury);
    event FeeClaimed(address indexed treasury, UFixed6 feeAmount);
    event RewardClaimed(address indexed account, UFixed6 rewardAmount);
    event ParameterUpdated(MarketParameter newParameter);
    event RiskParameterUpdated(RiskParameter newRiskParameter);
    event RewardUpdated(Token18 newReward);

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
    error MarketOperatorNotAllowed();
    error MarketNotSingleSidedError();
    error MarketExceedsPendingIdLimitError();
    error MarketRewardAlreadySetError();
    error MarketNotOwnerError();
    error PayoffProviderInvalidOracle();
    error PayoffProviderInvalidPayoffDefinitionError();

    error GlobalStorageInvalidError();
    error LocalStorageInvalidError();
    error RiskParameterStorageInvalidError();
    error MarketParameterStorageInvalidError();
    error PositionStorageLocalInvalidError();
    error VersionStorageInvalidError();

    function initialize(MarketDefinition calldata definition_, RiskParameter calldata parameter_) external;
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function token() external view returns (Token18);
    function reward() external view returns (Token18);
    function oracle() external view returns (IOracleProvider);
    function payoff() external view returns (IPayoffProvider);
    function treasury() external view returns (address);
    function at(uint256 version) external view returns (OracleVersion memory);
    function positions(address account) external view returns (Position memory);
    function pendingPositions(address account, uint256 id) external view returns (Position memory);
    function locals(address account) external view returns (Local memory);
    function versions(uint256 oracleVersion) external view returns (Version memory);
    function pendingPosition(uint256 id) external view returns (Position memory);
    function position() external view returns (Position memory);
    function global() external view returns (Global memory);
    function settle(address account) external;
    function update(address account, UFixed6 newMaker, UFixed6 newLong, UFixed6 newShort, Fixed6 newCollateral) external;
    function updateTreasury(address newTreasury) external;
    function updateReward(Token18 newReward) external;
    function parameter() external view returns (MarketParameter memory);
    function riskParameter() external view returns (RiskParameter memory);
    function updateParameter(MarketParameter memory newParameter) external;
    function updateRiskParameter(RiskParameter memory newRiskParameter) external;
}
