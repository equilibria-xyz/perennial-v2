// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import "../interfaces/IMetaQuantsFactory.sol";
import "../keeper/KeeperFactory.sol";

struct UpdateAndSignature {
    bytes encodedUpdate;
    bytes signature;
}

struct MetaQuantsUpdate {
    PythStructs.PriceFeed priceFeed;
    uint256 prevPublishTime;
}

contract MetaQuantsFactory is IMetaQuantsFactory, KeeperFactory {
    int32 private constant PARSE_DECIMALS = 18;
    address public immutable signer;

    constructor(
        address signer_,
        address implementation_,
        uint256 validFrom_,
        uint256 validTo_,
        KeepConfig memory commitKeepConfig_,
        KeepConfig memory settleKeepConfig_,
        uint256 keepCommitIncrementalBufferData_
    ) KeeperFactory(
        implementation_,
        validFrom_,
        validTo_,
        commitKeepConfig_,
        settleKeepConfig_,
        keepCommitIncrementalBufferData_
    ) {
        signer = signer_;
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
    ) internal override returns (Fixed18[] memory prices) {
        UpdateAndSignature[] memory updates = abi.decode(data, (UpdateAndSignature[]));
        if (updates.length != ids.length) revert MetaQuantsFactoryInputLengthMismatchError();

        prices = new Fixed18[](ids.length);
        for (uint256 i; i < updates.length; i++) {
            if (!_verifySignature(updates[i].encodedUpdate, updates[i].signature)) revert MetaQuantsFactoryInvalidSignatureError(updates[i].encodedUpdate, updates[i].signature);

            MetaQuantsUpdate memory parsedUpdate = abi.decode(updates[i].encodedUpdate, (MetaQuantsUpdate));

            if (parsedUpdate.priceFeed.id != toUnderlyingId[ids[i]]) revert MetaQuantsFactoryInvalidIdError(ids[i]);
            uint256 publishTime = parsedUpdate.priceFeed.price.publishTime;
            if (publishTime < version + validFrom || publishTime > version + validTo) revert MetaQuantsFactoryVersionOutsideRangeError();

            (Fixed18 significand, int256 exponent) =
                (Fixed18.wrap(parsedUpdate.priceFeed.price.price), parsedUpdate.priceFeed.price.expo + PARSE_DECIMALS);
            Fixed18 base = Fixed18Lib.from(int256(10 ** SignedMath.abs(exponent)));
            prices[i] = exponent < 0 ? significand.div(base) : significand.mul(base);
        }
    }

    function _verifySignature(bytes memory updateData, bytes memory signature) private view returns (bool) {
        return signer == ECDSA.recover(ECDSA.toEthSignedMessageHash(updateData), signature);
    }
}