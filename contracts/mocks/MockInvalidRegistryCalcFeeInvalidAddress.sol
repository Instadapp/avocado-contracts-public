// SPDX-License-Identifier: MIT
pragma solidity >=0.8.17;

contract MockInvalidRegistryCalcFeeInvalidAddress {
    // returns invalid return data for calcFee() so that abi.decode in caller will fail
    function calcFee(uint256 gasUsed_) public pure returns (uint256, address) {
        assembly {
            let freeMemoryPtr := mload(0x40)

            // Store uint256 at the free memory pointer
            mstore(freeMemoryPtr, 21)

            // Store max address + 1 at the next 20 bytes in memory (overflow uint160, will create an invalid address)
            mstore(add(freeMemoryPtr, 0x20), 0x10000000000000000000000000000000000000001)

            // Return the memory containing both as a tuple
            return(freeMemoryPtr, 0x40)
        }
    }

    function requireValidAvoVersion(address avoVersion_) external pure {}

    function requireValidAvoForwarderVersion(address avoForwarderVersion_) external pure {}
}
