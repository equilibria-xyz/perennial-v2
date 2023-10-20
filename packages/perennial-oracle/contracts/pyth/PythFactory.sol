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
    constructor(AbstractPyth pyth_, address implementation_) KeeperFactory(implementation_) {
        pyth = pyth_;
    }

    /// @notice Creates a new oracle instance
    /// @param id The id of the oracle to create
    /// @return newOracle The newly created oracle instance
    function create(bytes32 id) public override(IKeeperFactory, KeeperFactory) returns (IKeeperOracle newOracle) {
        if (!pyth.priceFeedExists(id)) revert PythFactoryInvalidIdError();
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
            ids,
            SafeCast.toUint64(version + MIN_VALID_TIME_AFTER_VERSION),
            SafeCast.toUint64(version + MAX_VALID_TIME_AFTER_VERSION)
        );

        for (uint256 i; i < parsedPrices.length; i++) {
            (Fixed6 significand, int256 exponent) =
                (Fixed6.wrap(parsedPrices[i].price.price), parsedPrices[i].price.expo + 6);
            Fixed6 base = Fixed6Lib.from(int256(10 ** SignedMath.abs(exponent)));
            prices[i] = exponent < 0 ? significand.div(base) : significand.mul(base);
        }
    }
}
