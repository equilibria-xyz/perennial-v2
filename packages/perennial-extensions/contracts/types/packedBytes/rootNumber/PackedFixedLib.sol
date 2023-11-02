pragma solidity ^0.8.0;

import "../PackedCalldataLib.sol";

using PackedFixedLib for PTR;

library PackedFixedLib {

  /// @dev Number of bytes in a int256 type
  uint256 private constant INT256_LENGTH = 31;

  /// @dev Number of bytes in a uint8 type
  uint256 internal constant UINT8_LENGTH = 1;

  function readFixed6(PTR memory ptr, bytes calldata input) internal pure returns (Fixed6 result) {
      int8 sign = ptr.readSign(input);
      result = Fixed6Lib.from(ptr.readInt256WithMagicValues(sign, input));
  }

  function readInt256WithMagicValues(PTR memory ptr, int8 sign, bytes calldata input) internal pure returns (int256 result) {
    uint8 len = ptr.readUint8(input);
    if (len > INT256_LENGTH) {
      ptr.pos += UINT8_LENGTH;
      return sign == 0 ? type(int256).max : type(int256).min;
    }

    result = int256(ptr.bytesToUint256(len, input));
    if (sign > 0) result *= -1;
    ptr.pos += len;
  }
}