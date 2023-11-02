pragma solidity ^0.8.0;

import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { UFixed18Lib, UFixed18 } from "@equilibria/root/number/types/UFixed18.sol";

import "../PackedCalldataLib.sol";


using PackedUFixedLib for PTR;

library PackedUFixedLib {

  /// @dev Number of bytes in a uint256 type
  uint256 internal constant UINT256_LENGTH = 32;

  /// @dev Number of bytes in a uint8 type
  uint256 internal constant UINT8_LENGTH = 1;

  function readUFixed6(PTR memory ptr, bytes calldata input) internal pure returns (UFixed6 result) {
    result = UFixed6.wrap(ptr.readUint256WithMagicValues(input));
  }

    /**
    * @notice Wraps next length of bytes as UFixed18
    * @param input Full calldata payload
    * @param ptr Current index of input to start decoding
    * @return result The decoded UFixed18
    */
  function readUFixed18(PTR memory ptr, bytes calldata input) internal pure returns (UFixed18 result) {
    result = UFixed18.wrap(ptr.readUint256WithMagicValues(input));
  }

  /**
    * @notice Helper function to get uint256 from calldata
    * @param input Full calldata payload
    * @param ptr Current index of input to start decoding
    * @return result The decoded uint256
    */
  function readUint256WithMagicValues(PTR memory ptr, bytes calldata input) internal pure returns (uint256 result) {
    uint8 len = ptr.readUint8(input);
    if (len > UINT256_LENGTH) {
      ptr.pos += UINT8_LENGTH;
      return type(uint256).max;
    }

    result = ptr.bytesToUint256(len, input);
    ptr.pos += len;
  }
}