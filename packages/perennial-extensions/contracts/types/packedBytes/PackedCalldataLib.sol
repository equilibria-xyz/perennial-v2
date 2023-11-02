pragma solidity ^0.8.0;

import { Fixed6, Fixed6Lib } from "@equilibria/root/number/types/Fixed6.sol";

struct PTR {
    uint256 pos;
}
using PackedCalldataLib for PTR global;

library PackedCalldataLib {

    /// @dev Number of bytes in a uint256 type
    uint256 internal constant UINT256_LENGTH = 32;

    /// @dev Number of bytes in a address type
    uint256 internal constant ADDRESS_LENGTH = 20;

    /// @dev Number of bytes in a int256 type
    uint256 private constant INT256_LENGTH = 31;

    /// @dev Number of bytes in a uint16 type
    uint256 internal constant UINT16_LENGTH = 2;

    /// @dev Number of bytes in a uint8 type
    uint256 internal constant UINT8_LENGTH = 1;

    error PackedBytesInvalidInt256LengthError();
    error PackedBytesInvalidUint256LengthError();


    /**
     * @notice Helper function to get uint8 length from calldata
     * @param input Full calldata payload
     * @param ptr Current index of input to start decoding
     * @return result The decoded uint8 length
     */
    function readUint8(PTR memory ptr, bytes calldata input) internal pure returns (uint8 result) {
        result = ptr.bytesToUint8(input);
        ptr.pos += UINT8_LENGTH;
    }

    function readInt8(PTR memory ptr, bytes calldata input) internal pure returns (int8 result) {
        int8 sign = ptr.readSign(input);
        result = sign * int8(ptr.readUint8(input));
    }

    function readUint16(PTR memory ptr, bytes calldata input) internal pure returns (uint16 result) {
        result = ptr.bytesToUint16(input);
        ptr.pos += UINT16_LENGTH;
    }

    // TODO can pack sign into length byte
    function readSign(PTR memory ptr, bytes calldata input) internal pure returns (int8 sign) {
        uint8 val = ptr.readUint8(input);
        if(val > 0) return -1;
        return 1;
    }

    function readInt256(PTR memory ptr, bytes calldata input) internal pure returns (int256 result) {
        uint8 len = ptr.readUint8(input);
        if (len > INT256_LENGTH) revert PackedBytesInvalidInt256LengthError();

        result = int256(ptr.bytesToUint256(len, input));
        ptr.pos += len;
    }

    /**
     * @notice Helper function to get uint256 from calldata
     * @param input Full calldata payload
     * @param ptr Current index of input to start decoding
     * @return result The decoded uint256
     */
    function readUint256(PTR memory ptr, bytes calldata input) internal pure returns (uint256 result) {
        uint8 len = ptr.readUint8(input);
        if (len > UINT256_LENGTH) revert PackedBytesInvalidUint256LengthError();

        result = ptr.bytesToUint256(len, input);
        ptr.pos += len;
    }

    function readBytes(PTR memory ptr, bytes calldata input) internal pure returns (bytes memory result) {
        uint16 len = ptr.readUint16(input);

        result = input[ptr.pos:ptr.pos+len];
        ptr.pos += len;
    }

    function readBytes32Array(PTR memory ptr, bytes calldata input) internal pure returns (bytes32[] memory result) {
        return result;
    }

    /**
     * @notice Implementation of GNSPS' standard BytesLib.sol
     * @param input 1 byte slice to convert to uint8 to decode lengths
     * @return result The uint8 representation of input
     */
    function bytesToUint8(PTR memory ptr, bytes calldata input) internal pure returns (uint8 result) {
        uint256 pos = ptr.pos;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            // 1) load calldata into temp starting at ptr position
            let temp := calldataload(add(input.offset, pos))
            // 2) shifts the calldata such that only the first byte is stored in result
            result := shr(mul(8, sub(UINT256_LENGTH, UINT8_LENGTH)), temp)
        }
    }

    function bytesToUint16(PTR memory ptr, bytes calldata input) internal pure returns (uint16 result) {
        uint256 pos = ptr.pos;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            // 1) load calldata into temp starting at ptr position
            let temp := calldataload(add(input.offset, pos))
            // 2) shifts the calldata such that only the first 2 bytes are stores in result
            result := shr(mul(8, sub(UINT256_LENGTH, UINT8_LENGTH)), temp)
        }
    }

    /**
     * @notice Unchecked loads arbitrarily-sized bytes into a uint
     * @dev Bytes length enforced as < max word size
     * @param input The bytes to convert to uint256
     * @return result The resulting uint256
     */
    function bytesToUint256(PTR memory ptr, uint256 len, bytes calldata input) internal pure returns (uint256 result) {
        uint256 pos = ptr.pos;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            // 1) load the calldata into result starting at the ptr position
            result := calldataload(add(input.offset, pos))
            // 2) shifts the calldata such that only the next length of bytes specified by `len` populates the uint256 result
            result := shr(mul(8, sub(UINT256_LENGTH, len)), result)
        }
    }

}