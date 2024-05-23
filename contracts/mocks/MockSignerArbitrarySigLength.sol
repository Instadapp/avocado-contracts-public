// SPDX-License-Identifier: MIT
pragma solidity >=0.8.18;

import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { IERC1271 } from "@openzeppelin/contracts/interfaces/IERC1271.sol";

contract MockSignerArbitrarySigLength is IERC1271 {
    /// @dev "magic value" according to EIP1271 https://eips.ethereum.org/EIPS/eip-1271#specification
    bytes4 internal constant EIP1271_MAGIC_VALUE = 0x1626ba7e;

    address immutable owner;

    constructor() {
        owner = msg.sender;
    }

    /// @dev returns valid magic value if signer is owner, using the first 65 bytes to validate. cutting of the rest
    /// to simulate a case where a smart contract signer implements some other non ECDSA default algorithm
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4 magicValue) {
        bytes memory signerBytes_ = signature[0:65];

        address recoveredSigner_ = ECDSA.recover(hash, signerBytes_);

        return recoveredSigner_ == owner ? EIP1271_MAGIC_VALUE : bytes4("");
    }
}
