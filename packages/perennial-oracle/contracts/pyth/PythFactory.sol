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
    constructor(
        AbstractPyth pyth_,
        address implementation_,
        uint256 validFrom_,
        uint256 validTo_,
        UFixed18 keepMultiplierBase_,
        uint256 keepBufferBase_,
        UFixed18 keepMultiplierData_,
        uint256 keepBufferData_
    ) KeeperFactory(implementation_, validFrom_, validTo_, keepMultiplierBase_, keepBufferBase_, keepMultiplierData_, keepBufferData_) {
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

    /// @notice Handles paying the keeper requested for given number of requested updates
    /// @param numRequested Number of requested price updates
    function _handleKeep(uint256 numRequested)
        private override
        keep(
            KeepConfig(
                keepMultiplierBase,
                keepBufferBase,
                keepMultiplierData,
                keepBufferData
            ),
            msg.data[0:0],
            IPythStaticFee(address(pyth)).singleUpdateFeeInWei() * numRequested,
            ""
        )
    { }
}
