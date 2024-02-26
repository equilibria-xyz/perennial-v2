// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Multicall } from "@openzeppelin/contracts/utils/Multicall.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { IMarket, Position, Order } from "@equilibria/perennial-v2/contracts/interfaces/IMarket.sol";
import { Token6 } from "@equilibria/root/token/types/Token6.sol";
import { Fixed6, Fixed6Lib } from "@equilibria/root/number/types/Fixed6.sol";
import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { UFixed18, UFixed18Lib } from "@equilibria/root/number/types/UFixed18.sol";
import { Kept } from "@equilibria/root/attribute/Kept/Kept.sol";
import { Ownable } from "@equilibria/root/attribute/Ownable.sol";
import { Initializable } from "@equilibria/root/attribute/Initializable.sol";

// TODO: price commit
// TODO: keep
// TODO: other structs
// TODO: account level batch cancel

contract Relayer is EIP712, Multicall, Kept {
    Token6 immutable token;

    UFixed6 private constant MAGIC_VALUE_UNCHANGED_POSITION = UFixed6.wrap(type(uint256).max);

    error RelayerInvalidSignatureError();
    error RelayerInvalidNonceError();
    error RelayerInvalidExpiryError();

    struct Intent {
        UFixed6 maxFee;
        bytes32 nonce;
        uint256 expiry;
    }

    struct Update {
        IMarket market;
        uint256 direction;
        Fixed6 magnitude;
        Fixed6 collateral;
        Intent intent;
    }

    bytes32 immutable public intentStructHash = keccak256("Intent(uint256 maxFee,bytes32 nonce,uint256 expiry)");
    bytes32 immutable public updateStructHash = keccak256("Update(address market,uint256 direction,int256 magnitude,int256 collateral,Intent(uint256 maxFee,bytes32 nonce,uint256 expiry))");
    bytes32 immutable public transferStructHash = keccak256("Transfer(address account,address marketFrom,address marketTo,uint256 amount,Intent(uint256 maxFee,bytes32 nonce,uint256 expiry))");

    uint256 private constant keepBufferBase = 0;
    uint256 private constant keepBufferCalldata = 0;

    mapping(bytes32 => bool) public nonces;
    mapping(address => Account) public accounts;

    constructor() EIP712("Perennial Relayer", "1.0.0") { }

    function create() external {
        accounts[msg.sender] = new Account();
    }

    function _validate(bytes32 nonce, uint256 expiry, bytes calldata signature) private view {
        if (signature.length != 65) revert RelayerInvalidSignatureError();
        if (nonces[nonce]) revert RelayerInvalidNonceError();
        if (expiry != 0 && block.timestamp > expiry) revert RelayerInvalidExpiryError();
    }

    function update(Update memory data, bytes calldata signature) external {
        _validate(data.intent.nonce, data.intent.expiry, signature);

        address account = ECDSA.recover(
            _hashTypedDataV4(keccak256(abi.encode(updateStructHash, data.market, data.direction, data.magnitude, data.collateral, data.maxFee, data.nonce, data.expiry))),
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
            abi.encode(account, data.market, data.maxFee)
        );

        Position memory currentPosition = data.market.positions(account);
        Order memory pending = data.market.pendings(account);
        currentPosition.update(pending, true);

        if (data.direction == 0) currentPosition.maker = UFixed6Lib.from(Fixed6Lib.from(currentPosition.maker).add(data.magnitude));
        if (data.direction == 1) currentPosition.long = UFixed6Lib.from(Fixed6Lib.from(currentPosition.long).add(data.magnitude));
        if (data.direction == 2) currentPosition.short = UFixed6Lib.from(Fixed6Lib.from(currentPosition.short).add(data.magnitude));

        if (data.collateral.gt(Fixed6Lib.ZERO)) accounts[account].pull(data.collateral.abs());

        data.market.update(
            account,
            currentPosition.maker,
            currentPosition.long,
            currentPosition.short,
            data.collateral,
            false
        );

        if (data.collateral.lt(Fixed6Lib.ZERO)) token.push(account, data.collateral.abs());

        nonces[data.nonce] = true;
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

contract Account is Initializable, Ownable {
    Token6 immutable token;

    function initialize() external initializer(1) {
        token.approve(owner());
    }

    function pull(UFixed6 amount) external onlyOwner {
        token.push(owner(), amount);
    }

    function withdraw(UFixed6 amount) external {
        // TODO
    }
}