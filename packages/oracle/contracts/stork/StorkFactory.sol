// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { Fixed18 } from "@equilibria/root/number/types/Fixed18.sol";
import { IGasOracle } from "@equilibria/root/gas/GasOracle.sol";
import { KeeperFactory } from "../keeper/KeeperFactory.sol";
import { IStork } from "../interfaces/IStork.sol";
import { IStorkFactory } from "../interfaces/IStorkFactory.sol";

/// @title StorkFactory
/// @notice Factory contract for creating and managing Stork oracles
contract StorkFactory is IStorkFactory, KeeperFactory {
    string public constant factoryType = "StorkFactory";

    /// @dev Stork contract
    IStork public immutable stork;

    /// @notice Initializes the immutable contract state
    /// @param stork_ Stork contract
    /// @param commitmentGasOracle_ Commitment gas oracle contract
    /// @param settlementGasOracle_ Settlement gas oracle contract
    /// @param implementation_ IStorkOracle implementation contract
    constructor(
        IStork stork_,
        IGasOracle commitmentGasOracle_,
        IGasOracle settlementGasOracle_,
        address implementation_
    ) KeeperFactory(commitmentGasOracle_, settlementGasOracle_, implementation_) {
        stork = stork_;
    }

    /// @notice Validates and parses the update data payload against the specified version
    /// @param ids The list of price feed ids to validate against
    /// @param data The update data to validate
    /// @return prices The parsed price list if valid
    function _parsePrices(
        bytes32[] memory ids,
        bytes calldata data
    ) internal view override returns (PriceRecord[] memory prices) {
        IStork.TemporalNumericValueInput[] memory updateData = abi.decode(data, (IStork.TemporalNumericValueInput[]));
        if (updateData.length != ids.length) revert StorkFactoryInputLengthMismatchError();

        prices = new PriceRecord[](ids.length);
        for (uint256 i; i < ids.length; i++) {
            if (updateData[i].id != ids[i]) revert StorkFactoryInvalidIdError();

            bool verified = stork.verifyStorkSignatureV1(
                stork.storkPublicKey(),
                updateData[i].id,
                updateData[i].temporalNumericValue.timestampNs,
                updateData[i].temporalNumericValue.quantizedValue,
                updateData[i].publisherMerkleRoot,
                updateData[i].valueComputeAlgHash,
                updateData[i].r,
                updateData[i].s,
                updateData[i].v
            );
            if (!verified) revert StorkFactoryInvalidSignatureError();

            (Fixed18 price, uint256 timestampNs) =
                (Fixed18.wrap(updateData[i].temporalNumericValue.quantizedValue),
                uint256(updateData[i].temporalNumericValue.timestampNs));
            prices[i] = PriceRecord(timestampNs / 1e9, price, 0);
        }
    }
}
