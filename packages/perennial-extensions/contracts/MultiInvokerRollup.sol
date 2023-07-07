pragma solidity ^0.8.13;

// solhint-disable, no-global-import
import "./interfaces/IMultiInvokerRollup.sol";
import "./MultiInvoker.sol";

// solhint-disable, no-inline-assembly
contract MultiInvokerRollup is IMultiInvokerRollup, MultiInvoker {

    /// @dev Number of bytes in a uint256 type
    uint256 private constant UINT256_LENGTH = 32;

    /// @dev Number of bytes in a address type
    uint256 private constant ADDRESS_LENGTH = 20;

    /// @dev Number of bytes in a uint8 type
    uint256 private constant UINT8_LENGTH = 1;

    constructor() {

    }

    fallback(bytes calldata input) external returns(bytes memory) {
        PTR memory ptr;
        decodeFallbackAndInvoke(input, ptr);
        return bytes("");
    }

    function decodeFallbackAndInvoke(bytes calldata input, PTR memory ptr) internal {
        while (ptr.pos < input.length) {
            PerennialAction action = PerennialAction(_readUint8(input, ptr));
            
            if (action == PerennialAction.UPDATE_POSITION) {
                // new maker new long new short new collateral\
                address market = _readAndCacheAddress(input, ptr);
                Fixed6 makerDelta = _readUFixed6(input, ptr);
                Fixed6 longDelta = _readUFixed6(input, ptr);
                Fixed6 shortDelta = _readUFixed6(input, ptr);
                Fixed6 collateralDelta = _readFixed6(input, ptr);
                bool handleWrap = _readBool(input, ptr);

                (UFixed6 newMaker, UFixed6 longDelta, UFixed6 shortDelta)
                    = _readAbsolutePosition(market, makerDelta, longDelta, shortDelta);

                _update(msg.sender, newMaker, newLong, newShort, collateralDelta);
            } else if (action == PerennialAction.PLACE_ORDER) {
                address market = _readAndCacheAddress(input, ptr);

                IKeeperManager.Order memory order; 
                (order.isLong, order.isLimit) = _readLimitAndLong(input, ptr);
                order.maxFee = _readFixed6(input, ptr);
                order.execPrice = _readFixed6(input, ptr);
                order.size = _readUFixed6(input, ptr);

                _placeOrder(msg.sender, market, order);
            } else if (action == PerennialAction.CANCEL_ORDER) {
                address market = _readAndCacheAddress(input, ptr);
                uint256 nonce = _readUint256(input, ptr);

                keeper.cancelOrder(msg.sender, market, nonce);
            } else if (action == PerennialAction.EXEC_ORDER) {
                address account = _readAndCacheAddress(input, ptr);
                address market = _readAndCacheAddress(input, ptr);
                uint256 nonce = _readUint256(input, ptr);

                _executeOrder(account, market, nonce);
            }
        }
    }

    function _readAbolutePosition(
        address market, 
        Fixed6 makerDelta, 
        Fixed6 longDelta, 
        Fixed6 shortDelta
    ) private view 
      returns (UFixed6 newMaker, UFixed6 newLong, UFixed6 newShort) {
        Position memory position = 
            IMarket(market).pendingPositions(
                msg.sender, 
                IMarket(market).locals(msg.sender).currentId
            );

        newMaker = UFixed6Lib.from(Fixed6Lib.from(position.maker).add(makerDelta));
        newLong = UFixed6Lib.from(Fixed6Lib.from(position.long).add(longDelta));
        newShort = UFixed6Lib.from(Fixed6Lib.from(position.short).add(shortDelta));
    }

    function _readAndCacheAddress(bytes calldata input, PTR memory ptr) private returns (address addr) {
        uint8 len = _readUint8(input, ptr);

        // user is new to registry, add next 20 bytes as address to registry and return address
        if (len == 0) {
            result = _bytesToAddress(input[ptr.pos:ptr.pos + ADDRESS_LENGTH]);
            ptr.pos += ADDRESS_LENGTH;

            _cacheAddress(result);
        } else {
            uint256 idx = _bytesToUint256(input, ptr.pos, len);
            ptr.pos += len;

            result = _lookupAddress(idx);
        }
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


    function _readOrder(bytes calldata input, PTR memory ptr) private pure returns (IKeeperManager.Order memory order) {
        (order.isLong, order.isLimit) = _readLimitAndLong(input, ptr);
        order.maxFee = _readFixed6(input, ptr);
        order.execPrice = _readFixed6(input, ptr);
        order.size = _readUFixed6(input, ptr);
    }

    /**
     * @notice Helper function to get uint8 length from calldata
     * @param input Full calldata payload
     * @param ptr Current index of input to start decoding
     * @return result The decoded uint8 length
     */
    function _readUint8(bytes calldata input, PTR memory ptr) private pure returns (uint8 result) {
        result = _bytesToUint8(input, ptr.pos);
        ptr.pos += UINT8_LENGTH;
    }

    function _readLimitAndLong(bytes calldata input, PTR memory ptr) private pure returns (bool isLong, bool isLimit) {
        (isLong, isLimit) = _bytesToLimitAndLong(input, ptr.pos);
        ptr.pos += UINT8_LENGTH;
    }

    function _readUFixed6(bytes calldata input, PTR memory ptr) private pure returns (UFixed6 result) {
        result = UFixed6.wrap(_readUint256(input, ptr));
    }

    function _readFixed6(bytes calldata input, PTR memory ptr) private pure returns (Fixed6 result) {
        result = Fixed6.wrap(_readUint256(input, ptr));
    }

    /**
     * @notice Helper function to get uint256 from calldata
     * @param input Full calldata payload
     * @param ptr Current index of input to start decoding
     * @return result The decoded uint256
     */
    function _readUint256(bytes calldata input, PTR memory ptr) private pure returns (uint256 result) {
        uint8 len = _readUint8(input, ptr);
        if (len > UINT256_LENGTH) revert MultiInvokerRollupInvalidUint256LengthError();

        result = _bytesToUint256(input, ptr.pos, len);
        ptr.pos += len;
    }


    /**
     * @notice Implementation of GNSPS' standard BytesLib.sol
     * @param input 1 byte slice to convert to uint8 to decode lengths
     * @return result The uint8 representation of input
     */
    function _bytesToUint8(bytes calldata input, uint256 pos) private pure returns (uint8 result) {
        assembly {
            // 1) load calldata into temp starting at ptr position 
            let temp := calldataload(add(input.offset, pos))
            // 2) shifts the calldata such that only the first byte is stored in result
            result := shr(mul(8, sub(UINT256_LENGTH, UINT8_LENGTH)), temp)
        }
    }

    /**
     * @notice Extracts 2 bools from uint8 values 0(FF), 1(FT), 2(TF), 3(TT)
     * @dev @todo this is actually easier to read than masking which requires conversions and bitmasks
     */
    function _bytesToLimitAndLong(bytes calldata input, uint256 pos) private pure returns (bool isLong, bool isLimit) {
        assembly {
            // 1) load calldata into temp starting at ptr position
            let temp := shr(248, calldataload(add(input.offset, pos)))
            // 2) get isLong (0010)
            isLong := and(temp, 0x02)
            // 3) get isShort (0001)
            isLimit := and(temp, 0x01)
        }
    }

    /**
     * @dev This is called in decodeAccount and decodeProduct which both only pass 20 byte slices
     * @notice Unchecked force of 20 bytes into address
     * @param input The 20 bytes to be converted to address
     * @return result Address representation of `input`
    */
    function _bytesToAddress(bytes memory input) private pure returns (address result) {
        assembly {
            result := mload(add(input, ADDRESS_LENGTH))
        }
    }

    /**
     * @notice Unchecked loads arbitrarily-sized bytes into a uint
     * @dev Bytes length enforced as < max word size
     * @param input The bytes to convert to uint256
     * @return result The resulting uint256
     */
    function _bytesToUint256(bytes calldata input, uint256 pos, uint256 len) private pure returns (uint256 result) {
        assembly {
            // 1) load the calldata into result starting at the ptr position
            result := calldataload(add(input.offset, pos))
            // 2) shifts the calldata such that only the next length of bytes specified by `len` populates the uint256 result
            result := shr(mul(8, sub(UINT256_LENGTH, len)), result) 
        }
    }
}