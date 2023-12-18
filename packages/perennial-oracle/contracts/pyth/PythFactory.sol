// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@pythnetwork/pyth-sdk-solidity/AbstractPyth.sol";
import "../interfaces/IPythFactory.sol";
import "../keeper/KeeperFactory.sol";

/// @title PythFactory
/// @notice Factory contract for creating and managing Pyth oracles
contract PythFactory is IPythFactory, KeeperFactory {
    /// @dev Pyth contract
    AbstractPyth public immutable pyth;

    /// @notice Initializes the immutable contract state
    /// @param pyth_ Pyth contract
    /// @param implementation_ IPythOracle implementation contract
    /// @param validFrom_ The minimum time after a version that a keeper update can be valid
    /// @param validTo_ The maximum time after a version that a keeper update can be valid
    /// @param commitKeepConfig_ Parameter configuration for commit keeper incentivization
    /// @param settleKeepConfig_ Parameter configuration for settle keeper incentivization
    constructor(
        AbstractPyth pyth_,
        address implementation_,
        uint256 validFrom_,
        uint256 validTo_,
        KeepConfig memory commitKeepConfig_,
        KeepConfig memory settleKeepConfig_,
        uint256 keepCommitIncrementalBufferData_
    ) KeeperFactory(implementation_, validFrom_, validTo_, commitKeepConfig_, settleKeepConfig_, keepCommitIncrementalBufferData_) {
        pyth = pyth_;
    }

    /// @notice Creates a new oracle instance
    /// @param id The id of the oracle to create
    /// @return newOracle The newly created oracle instance
    function create(bytes32 id) public override(IKeeperFactory, KeeperFactory) returns (IKeeperOracle newOracle) {
        if (!pyth.priceFeedExists(toUnderlyingId[id])) revert PythFactoryInvalidIdError();
        return super.create(id);
    }

    /// @notice Validates and parses the update data payload against the specified version
    /// @param ids The list of price feed ids validate against
    /// @param version The oracle version to validate against
    /// @param data The update data to validate
    /// @return prices The parsed price list if valid
    function _parsePrices(
        bytes32[] memory ids,
        uint256 version,
        bytes calldata data
    ) internal override returns (Fixed6[] memory prices) {
        prices = new Fixed6[](ids.length);
        bytes[] memory datas = new bytes[](1);
        datas[0] = data;

        PythStructs.PriceFeed[] memory parsedPrices = pyth.parsePriceFeedUpdates{value: msg.value}(
            datas,
            _toUnderlyingIds(ids),
            SafeCast.toUint64(version + validFrom),
            SafeCast.toUint64(version + validTo)
        );

        for (uint256 i; i < parsedPrices.length; i++) {
            (Fixed6 significand, int256 exponent) =
                (Fixed6.wrap(parsedPrices[i].price.price), parsedPrices[i].price.expo + 6);
            Fixed6 base = Fixed6Lib.from(int256(10 ** SignedMath.abs(exponent)));
            prices[i] = exponent < 0 ? significand.div(base) : significand.mul(base);
        }
    }

    /// @notice Converts a list of oracle ids to a list of underlying ids
    /// @dev Reverts if any of the ids are not associated
    /// @param ids The list of oracle ids to convert
    /// @return underlyingIds The list of underlying ids
    function _toUnderlyingIds(bytes32[] memory ids) private view returns (bytes32[] memory underlyingIds) {
        underlyingIds = new bytes32[](ids.length);
        for (uint256 i; i < ids.length; i++) {
            if (!associated(ids[i])) revert KeeperFactoryNotAssociatedError();
            underlyingIds[i] = toUnderlyingId[ids[i]];
        }
    }

    /// @notice Returns the applicable value for the keeper fee
    /// @param numRequested The number of requested price commits
    /// @return The applicable value for the keeper fee
    function _applicableValue(uint256 numRequested, bytes memory) internal view override returns (uint256) {
        return IPythStaticFee(address(pyth)).singleUpdateFeeInWei() * numRequested;
    }
}
