// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { IMarket, Position, Order } from "@equilibria/perennial-v2/contracts/interfaces/IMarket.sol";
import { Fixed6, Fixed6Lib } from "@equilibria/root/number/types/Fixed6.sol";
import { UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";

// TODO: price commit
// TODO: keep
// TODO: other structs

contract Relayer is EIP712 {
    error RelayerInvalidSignatureError();

    bytes32 immutable public updateStructHash = keccak256("Update(address market,uint256 direction,int256 magnitude)");

    // Update(address account,address market,uint256 direction,int256 magnitude)
    // Withdrawal(address account,address market,uint256 amount)
    // Transfer(address account,address marketFrom,address marketTo,uint256 amount)

    constructor() EIP712("Perennial Relayer", "1.0.0") { }

    function update(
        IMarket market,
        uint256 direction,
        Fixed6 magnitude,
        bytes calldata signature
    ) external {
        if (signature.length != 65) revert RelayerInvalidSignatureError();

        address account = ECDSA.recover(
            _hashTypedDataV4(keccak256(abi.encode(updateStructHash, market, direction, magnitude))),
            signature
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
            Fixed6Lib.ZERO,
            false
        );
    }
}
