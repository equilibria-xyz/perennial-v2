// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Multicall } from "@openzeppelin/contracts/utils/Multicall.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { IMarket, Position, Order } from "@equilibria/perennial-v2/contracts/interfaces/IMarket.sol";
import { Fixed6, Fixed6Lib } from "@equilibria/root/number/types/Fixed6.sol";
import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { UFixed18, UFixed18Lib } from "@equilibria/root/number/types/UFixed18.sol";
import { Kept } from "@equilibria/root/attribute/Kept/Kept.sol";

// TODO: price commit
// TODO: keep
// TODO: other structs
// TODO: account level batch cancel

contract Relayer is EIP712, Multicall, Kept {
    UFixed6 private constant MAGIC_VALUE_UNCHANGED_POSITION = UFixed6.wrap(type(uint256).max);

    error RelayerInvalidSignatureError();
    error RelayerInvalidNonceError();
    error RelayerInvalidExpiryError();

    bytes32 immutable public updateStructHash = keccak256("Update(address market,uint256 direction,int256 magnitude,uint256 collateral,uint256 maxFee,bytes32 nonce,uint256 expiry)");
    bytes32 immutable public transferStructHash = keccak256("Transfer(address account,address marketFrom,address marketTo,uint256 amount,uint256 maxFee,bytes32 nonce,uint256 expiry)");


    uint256 private constant keepBufferBase = 0;
    uint256 private constant keepBufferCalldata = 0;

    mapping(bytes32 => bool) public nonces;

    constructor() EIP712("Perennial Relayer", "1.0.0") { }

    function _validate(bytes32 nonce, uint256 expiry, bytes calldata signature) private view {
        if (signature.length != 65) revert RelayerInvalidSignatureError();
        if (nonces[nonce]) revert RelayerInvalidNonceError();
        if (expiry != 0 && block.timestamp > expiry) revert RelayerInvalidExpiryError();
    }

    function update(
        IMarket market,
        uint256 direction,
        Fixed6 magnitude,
        UFixed6 collateral,
        UFixed6 maxFee,
        bytes32 nonce,
        uint256 expiry,
        bytes calldata signature
    ) external {
        _validate(nonce, expiry, signature);

        address account = ECDSA.recover(
            _hashTypedDataV4(keccak256(abi.encode(updateStructHash, market, direction, magnitude, collateral, maxFee, nonce, expiry))),
            signature
        );

        _handleKeeperFee(
            KeepConfig(
                UFixed18Lib.ZERO,
                keepBufferBase,
                UFixed18Lib.ZERO,
                keepBufferCalldata
            ),
            0,
            msg.data,
            0,
            abi.encode(account, market, maxFee)
        );

        Position memory currentPosition = market.positions(account);
        Order memory pending = market.pendings(account);
        currentPosition.update(pending, true);

        if (direction == 0) currentPosition.maker = UFixed6Lib.from(Fixed6Lib.from(currentPosition.maker).add(magnitude));
        if (direction == 1) currentPosition.long = UFixed6Lib.from(Fixed6Lib.from(currentPosition.long).add(magnitude));
        if (direction == 2) currentPosition.short = UFixed6Lib.from(Fixed6Lib.from(currentPosition.short).add(magnitude));

        market.update(
            account,
            currentPosition.maker,
            currentPosition.long,
            currentPosition.short,
            Fixed6Lib.from(-1, collateral), // only withdrawal allowed
            false
        );
        
        // TODO: unwrap and transfer on withdrawal

        nonces[nonce] = true;
    }

    function _raiseKeeperFee(UFixed18 keeperFee, bytes memory data) internal virtual override returns (UFixed18) {
        (address account, IMarket market, UFixed6 maxFee) = abi.decode(data, (address, IMarket, UFixed6));
        UFixed6 raisedKeeperFee = UFixed6Lib.from(keeperFee, true).min(maxFee);

        market.update(
            account,
            MAGIC_VALUE_UNCHANGED_POSITION,
            MAGIC_VALUE_UNCHANGED_POSITION,
            MAGIC_VALUE_UNCHANGED_POSITION,
            Fixed6Lib.from(-1, raisedKeeperFee),
            false
        );

        return UFixed18Lib.from(raisedKeeperFee);
    }
}
