// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { SignedMath } from "@openzeppelin/contracts/utils/math/SignedMath.sol";
import { Fixed18, Fixed18Lib } from "@equilibria/root/number/types/Fixed18.sol";
import { IGasOracle } from "@equilibria/root/gas/GasOracle.sol";
import { IMetaQuantsFactory } from "../interfaces/IMetaQuantsFactory.sol";
import { KeeperFactory } from "../keeper/KeeperFactory.sol";

contract MetaQuantsFactory is IMetaQuantsFactory, KeeperFactory {
    int32 private constant PARSE_DECIMALS = 18;

    address public immutable signer;

    bytes32 private immutable _factoryType;

    constructor(
        address signer_,
        IGasOracle commitmentGasOracle_,
        IGasOracle settlementGasOracle_,
        string memory factoryType_,
        address implementation_
    ) KeeperFactory(commitmentGasOracle_, settlementGasOracle_, implementation_) {
        signer = signer_;
        bytes memory bstr = bytes(factoryType_);
        _factoryType = bytes32(uint256(bytes32(bstr)) | bstr.length);
    }

    /// @dev Uses's OZ's short string storage util (only available in newer versions of oz/contracts)
    ///      https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/utils/ShortStrings.sol
    function factoryType() external view returns (string memory) {
        bytes32 shortString = _factoryType;
        uint256 len = uint256(_factoryType) & 0xFF;
        string memory str = new string(32);
        assembly ("memory-safe") {
            mstore(str, len)
            mstore(add(str, 0x20), shortString)
        }
        return str;
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
