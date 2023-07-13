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
        string name; // TODO: move to oracle / payoff?
        string symbol; // TODO: move to oracle / payoff?
        Token18 token;
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

    event Updated(address indexed account, uint256 version, UFixed6 newMaker, UFixed6 newLong, UFixed6 newShort, Fixed6 collateral, bool protect);
    event BeneficiaryUpdated(address newBeneficiary);
    event CoordinatorUpdated(address newCoordinator);
    event FeeClaimed(address indexed account, UFixed6 amount);
    event RewardClaimed(address indexed account, UFixed6 amount);
    event ParameterUpdated(MarketParameter newParameter);
    event RiskParameterUpdated(RiskParameter newRiskParameter);
    event RewardUpdated(Token18 newReward);

    error MarketInsufficientLiquidityError();
    error MarketInsufficientCollateralizationError();
    error MarketInsufficientCollateralError();
    error MarketProtectedError();
    error MarketMakerOverLimitError();
    error MarketClosedError();
    error MarketCollateralBelowLimitError();
    error MarketOperatorNotAllowedError();
    error MarketNotSingleSidedError();
    error MarketExceedsPendingIdLimitError();
    error MarketRewardAlreadySetError();
    error MarketInvalidRewardError();
    error MarketNotCoordinatorError();
    error MarketNotBeneficiaryError();
    error MarketInvalidProtectionError();
    error MarketStalePriceError();
    error MarketEfficiencyUnderLimitError();
    error MarketInvalidMarketParameterError(uint256 code);
    error MarketInvalidRiskParameterError(uint256 code);

    error GlobalStorageInvalidError();
    error LocalStorageInvalidError();
    error MarketParameterStorageInvalidError();
    error PositionStorageLocalInvalidError();
    error RiskParameterStorageInvalidError();
    error VersionStorageInvalidError();

    function initialize(MarketDefinition calldata definition_, RiskParameter calldata parameter_) external;
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function token() external view returns (Token18);
    function reward() external view returns (Token18);
    function oracle() external view returns (IOracleProvider);
    function payoff() external view returns (IPayoffProvider);
    function beneficiary() external view returns (address);
    function coordinator() external view returns (address);
    function at(uint256 version) external view returns (OracleVersion memory);
    function positions(address account) external view returns (Position memory);
    function pendingPositions(address account, uint256 id) external view returns (Position memory);
    function locals(address account) external view returns (Local memory);
    function versions(uint256 oracleVersion) external view returns (Version memory);
    function pendingPosition(uint256 id) external view returns (Position memory);
    function position() external view returns (Position memory);
    function global() external view returns (Global memory);
    function update(address account, UFixed6 newMaker, UFixed6 newLong, UFixed6 newShort, Fixed6 collateral, bool protect) external;
    function updateBeneficiary(address newBeneficiary) external;
    function updateCoordinator(address newCoordinator) external;
    function updateReward(Token18 newReward) external;
    function parameter() external view returns (MarketParameter memory);
    function riskParameter() external view returns (RiskParameter memory);
    function updateParameter(MarketParameter memory newParameter) external;
    function updateRiskParameter(RiskParameter memory newRiskParameter) external;
    function claimFee() external;
    function claimReward() external;
}
