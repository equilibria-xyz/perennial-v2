// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import { SignedMath } from "@openzeppelin/contracts/utils/math/SignedMath.sol";
import { IGasOracle } from "@equilibria/root/gas/GasOracle.sol";
import { Fixed18, Fixed18Lib } from "@equilibria/root/number/types/Fixed18.sol";
import { AbstractPyth, PythStructs } from "@pythnetwork/pyth-sdk-solidity/AbstractPyth.sol";
import { IPythFactory, IPythStaticFee } from "../interfaces/IPythFactory.sol";
import { IKeeperOracle } from "../interfaces/IKeeperOracle.sol";
import { IKeeperFactory } from "../interfaces/IKeeperFactory.sol";
import { KeeperFactory } from "../keeper/KeeperFactory.sol";

/// @title PythFactory
/// @notice Factory contract for creating and managing Pyth oracles
contract PythFactory is IPythFactory, KeeperFactory {
    int32 private constant PARSE_DECIMALS = 18;
    string public constant factoryType = "PythFactory";

    /// @dev Pyth contract
    AbstractPyth public immutable pyth;

    /// @notice Initializes the immutable contract state
    /// @param pyth_ Pyth contract
    /// @param commitmentGasOracle_ Commitment gas oracle contract
    /// @param settlementGasOracle_ Settlement gas oracle contract
    /// @param implementation_ IPythOracle implementation contract
    constructor(
        AbstractPyth pyth_,
        IGasOracle commitmentGasOracle_,
        IGasOracle settlementGasOracle_,
        address implementation_
    ) KeeperFactory(commitmentGasOracle_, settlementGasOracle_, implementation_) {
        pyth = pyth_;
    }

    /// @notice Creates a new oracle instance
    /// @param id The id of the oracle to create
    /// @param underlyingId The underlying id of the oracle to create
    /// @param payoff The payoff provider contract
    /// @return newOracle The newly created oracle instance
    function create(
        bytes32 id,
        bytes32 underlyingId,
        PayoffDefinition memory payoff
    ) public override(IKeeperFactory, KeeperFactory) returns (IKeeperOracle newOracle) {
        if (!pyth.priceFeedExists(underlyingId)) revert PythFactoryInvalidIdError();
        return super.create(id, underlyingId, payoff);
    }

    /// @notice Validates and parses the update data payload against the specified version
    /// @param underlyingIds The list of price feed ids validate against
    /// @param data The update data to validate
    /// @return prices The parsed price list if valid
    function _parsePrices(
        bytes32[] memory underlyingIds,
        bytes calldata data
    ) internal override returns (PriceRecord[] memory prices) {
        prices = new PriceRecord[](underlyingIds.length);
        bytes[] memory datas = new bytes[](1);
        datas[0] = data;

        PythStructs.PriceFeed[] memory parsedPrices = pyth.parsePriceFeedUpdates{value: msg.value}(
            datas,
            underlyingIds,
            type(uint64).min,
            type(uint64).max
        );

        uint256 updateFee = IPythStaticFee(address(pyth)).singleUpdateFeeInWei();

        for (uint256 i; i < parsedPrices.length; i++) {
            (Fixed18 significand, int256 exponent) =
                (Fixed18.wrap(parsedPrices[i].price.price), parsedPrices[i].price.expo + PARSE_DECIMALS);
            Fixed18 base = Fixed18Lib.from(int256(10 ** SignedMath.abs(exponent)));
            prices[i] = PriceRecord(
                parsedPrices[i].price.publishTime,
                exponent < 0 ? significand.div(base) : significand.mul(base),
                updateFee
            );
        }
    }
}
