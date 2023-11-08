// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "./MultiInvoker.sol";
import "./interfaces/IMultiInvokerRollup.sol";
import "hardhat/console.sol";

contract MultiInvokerRollup is IMultiInvokerRollup, MultiInvoker {
    using PackedFixedLib for PTR;
    using PackedUFixedLib for PTR;

    /// @dev Number of bytes in a address type
    uint256 private constant ADDRESS_LENGTH = 20;

    /// @dev Array of all stored addresses (users, products, vaults, etc) for calldata packing
    address[] public addressCache;

    /// @dev Index lookup of above array for constructing calldata
    mapping(address => uint256) public addressLookup;

    /// @dev magic byte to prepend to calldata for the fallback.
    /// Prevents public fns from being called by arbitrary fallback data
    uint8 public constant INVOKE_ID = 73;

    /**
     * @notice Constructs the contract
     * @param usdc_ The USDC token contract address
     * @param batcher_ The DSU batcher contract address
     * @param reserve_ The DSU reserve contract address
     */
    constructor(
        Token6 usdc_,
        Token18 dsu_,
        IFactory marketFactory_,
        IFactory vaultFactory_,
        IBatcher batcher_,
        IEmptySetReserve reserve_,
        uint256 keepBufferBase_,
        uint256 keepBufferCalldata_
    ) MultiInvoker (usdc_, dsu_, marketFactory_, vaultFactory_, batcher_, reserve_, keepBufferBase_, keepBufferCalldata_) {
        _cacheAddress(address(0)); // Cache 0-address to avoid 0-index lookup collision
    }

    /**
     * @notice This function serves exactly the same as invoke(Invocation[] memory invocations),
     *         but includes logic to handle the highly packed calldata
     * @dev   Fallback eliminates need for 4 byte sig. MUST prepend INVOKE_ID to calldata
     * @param input Packed data to pass to invoke logic
     * @return required no-op
     */
    fallback (bytes calldata input) external returns (bytes memory) {
        PTR memory ptr;
        if (ptr.readUint8(input) != INVOKE_ID) revert MultiInvokerRollupMissingMagicByteError();

        _decodeFallbackAndInvoke(input, ptr);
        return "";
    }

    /**
     * @notice Processes invocation with highly packed data
     * @dev
     * Encoding Scheme:
     *   [0:1] => uint action
     *   [1:2] => uint length of current encoded type
     *   [2:length] => current encoded type (see individual type decoding functions)
     * @param input Packed data to pass to invoke logic
     */
    function _decodeFallbackAndInvoke(bytes calldata input, PTR memory ptr) internal {
        while (ptr.pos < input.length) {
            PerennialAction action = PerennialAction(ptr.readUint8(input));

            if (action == PerennialAction.UPDATE_POSITION) {
                IMarket market = IMarket(_readAndCacheAddress(ptr, input));
                UFixed6 newMaker = ptr.readUFixed6(input);
                UFixed6 newLong = ptr.readUFixed6(input);
                UFixed6 newShort = ptr.readUFixed6(input);
                Fixed6  collateral = ptr.readFixed6(input);
                bool wrap = ptr.readUint8(input) == 0 ? false : true;
                InterfaceFee memory interfaceFee = _readInterfaceFee(ptr, input);

                _update(msg.sender, market, newMaker, newLong, newShort, collateral, wrap, interfaceFee);
            } else if (action == PerennialAction.UPDATE_VAULT) {
                IVault vault = IVault(_readAndCacheAddress(ptr, input));
                UFixed6 depositAssets = ptr.readUFixed6(input);
                UFixed6 redeemShares = ptr.readUFixed6(input);
                UFixed6 claimAssets = ptr.readUFixed6(input);
                bool wrap = ptr.readUint8(input) == 0? false : true;

                _vaultUpdate(vault, depositAssets, redeemShares, claimAssets, wrap);
            } else if (action == PerennialAction.PLACE_ORDER) {
                IMarket market = IMarket(_readAndCacheAddress(ptr, input));
                TriggerOrder memory order = _readOrder(ptr, input);

                _placeOrder(msg.sender, market, order);
            } else if (action == PerennialAction.CANCEL_ORDER) {
                IMarket market = IMarket(_readAndCacheAddress(ptr, input));
                uint256 nonce = ptr.readUint256(input);

                _cancelOrder(msg.sender, market, nonce);
            } else if (action == PerennialAction.EXEC_ORDER) {
                address account = _readAndCacheAddress(ptr, input);
                IMarket market = IMarket(_readAndCacheAddress(ptr, input));
                uint256 nonce = ptr.readUint256(input);

                _executeOrder(account, market, nonce);
            } else if (action == PerennialAction.COMMIT_PRICE) {
                address oracleProviderFactory = _readAndCacheAddress(ptr, input);
                uint256 value = ptr.readUint256(input);
                bytes32[] memory ids = ptr.readBytes32Array(input);
                uint256 index = ptr.readUint256(input);
                uint256 version = ptr.readUint256(input);
                bytes memory data = ptr.readBytes(input);
                bool revertOnFailure = ptr.readUint8(input) == 0 ? false : true;

                _commitPrice(oracleProviderFactory, value, ids, version, data, revertOnFailure);
            } else if (action == PerennialAction.LIQUIDATE) {
                IMarket market = IMarket(_readAndCacheAddress(ptr, input));
                address account = _readAndCacheAddress(ptr, input);
                bool revertOnFailure = ptr.readUint8(input) == 0 ? false : true;

                _liquidate(market, account, revertOnFailure);
            } else if (action == PerennialAction.APPROVE) {
                address target = _readAndCacheAddress(ptr, input);
                _approve(target);
            }
        }
    }

    /**
     * @notice Helper function to get address from calldata
     * @param input Full calldata payload
     * @param ptr Current index of input to start decoding
     * @return result The decoded address
     */
    function _readAndCacheAddress(PTR memory ptr, bytes calldata input) private returns (address result) {
        uint8 len = ptr.readUint8(input);

        // user is new to registry, add next 20 bytes as address to registry and return address
        if (len == 0) {
            result = _bytesToAddress(input[ptr.pos:ptr.pos + ADDRESS_LENGTH]);
            ptr.pos += ADDRESS_LENGTH;

            _cacheAddress(result);
        } else {
            uint256 idx = ptr.bytesToUint256(len, input);
            ptr.pos += len;

            result = _lookupAddress(idx);
        }
    }

    /**
     * @notice Unchecked sets address in cache
     * @param value Address to add to cache
     */
    function _cacheAddress(address value) private {
        uint256 index = addressCache.length;
        addressCache.push(value);
        addressLookup[value] = index;

        emit AddressAddedToCache(value, index);
    }

    /**
     * @notice Checked gets the address in cache mapped to the cache index
     * @dev There is an issue with the calldata if a txn uses cache before caching address
     * @param index The cache index
     * @return result Address stored at cache index
     */
    function _lookupAddress(uint256 index) private view returns (address result) {
        result = addressCache[index];
        if (result == address(0)) revert MultiInvokerRollupAddressIndexOutOfBoundsError();
    }

    function _readOrder(PTR memory ptr, bytes calldata input) private pure returns (TriggerOrder memory order) {
        order.side = ptr.readUint8(input);
        order.comparison = ptr.readInt8(input);
        order.fee = ptr.readUFixed6(input);
        order.price = ptr.readFixed6(input);
        order.delta = ptr.readFixed6(input);
    }

    function _readInterfaceFee(PTR memory ptr, bytes calldata input) internal returns (InterfaceFee memory result) {
        result.amount = ptr.readUFixed6(input);
        result.receiver = _readAndCacheAddress(ptr, input);
        result.unwrap = ptr.readUint8(input) > 0 ? true : false;
    }


    /**
     * @dev This is called in decodeAccount and decodeProduct which both only pass 20 byte slices
     * @notice Unchecked force of 20 bytes into address
     * @param input The 20 bytes to be converted to address
     * @return result Address representation of `input`
    */
    function _bytesToAddress(bytes memory input) private pure returns (address result) {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            result := mload(add(input, ADDRESS_LENGTH))
        }
    }
}