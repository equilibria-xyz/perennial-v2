// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "../interfaces/IMetaQuantsFactory.sol";
import "../keeper/KeeperFactory.sol";

contract MetaQuantsFactory is IMetaQuantsFactory, KeeperFactory {
    int32 private constant PARSE_DECIMALS = 18;

    address public immutable signer;

    constructor(
        address signer_,
        IGasOracle commitmentGasOracle_,
        IGasOracle settlementGasOracle_,
        address implementation_
    ) KeeperFactory(commitmentGasOracle_, settlementGasOracle_, implementation_) {
        signer = signer_;
    }

    /// @notice Validates and parses the update data payload against the specified version
    /// @param underlyingIds The list of price feed ids validate against
    /// @param data The update data to validate
    /// @return prices The parsed price list if valid
    function _parsePrices(
        bytes32[] memory underlyingIds,
        bytes calldata data
    ) internal view override returns (PriceRecord[] memory prices) {
        UpdateAndSignature[] memory updates = abi.decode(data, (UpdateAndSignature[]));
        if (updates.length != underlyingIds.length) revert MetaQuantsFactoryInputLengthMismatchError();

        prices = new PriceRecord[](underlyingIds.length);
        for (uint256 i; i < updates.length; i++) {
            if (!_verifySignature(updates[i].encodedUpdate, updates[i].signature))
                revert MetaQuantsFactoryInvalidSignatureError();

            MetaQuantsUpdate memory parsedUpdate = abi.decode(updates[i].encodedUpdate, (MetaQuantsUpdate));

            if (parsedUpdate.priceFeed.id != underlyingIds[i]) revert MetaQuantsFactoryInvalidIdError();

            (Fixed18 significand, int256 exponent) =
                (Fixed18.wrap(parsedUpdate.priceFeed.price.price), parsedUpdate.priceFeed.price.expo + PARSE_DECIMALS);
            Fixed18 base = Fixed18Lib.from(int256(10 ** SignedMath.abs(exponent)));
            prices[i] = PriceRecord(
                parsedUpdate.priceFeed.price.publishTime,
                exponent < 0 ? significand.div(base) : significand.mul(base),
                0
            );
        }
    }

    function _verifySignature(bytes memory updateData, bytes memory signature) private view returns (bool) {
        return signer == ECDSA.recover(ECDSA.toEthSignedMessageHash(updateData), signature);
    }
}
