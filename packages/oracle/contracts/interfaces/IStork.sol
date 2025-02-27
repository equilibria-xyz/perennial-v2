// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

interface IStork {
    struct TemporalNumericValue {
        uint64 timestampNs; // 8 bytes
        int192 quantizedValue; // 8 bytes
    }

    struct TemporalNumericValueInput {
        TemporalNumericValue temporalNumericValue;
        bytes32 id;
        bytes32 publisherMerkleRoot;
        bytes32 valueComputeAlgHash;
        bytes32 r;
        bytes32 s;
        uint8 v;
    }

    function storkPublicKey() external view returns (address);
    function verifyStorkSignatureV1(
        address storkPubKey,
        bytes32 id,
        uint256 recvTime,
        int256 quantizedValue,
        bytes32 publisherMerkleRoot,
        bytes32 valueComputeAlgHash,
        bytes32 r,
        bytes32 s,
        uint8 v
    ) external pure returns (bool);
}
