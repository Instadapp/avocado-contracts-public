// SPDX-License-Identifier: MIT
pragma solidity >=0.8.17;

contract MockInvalidRegistryCalcFeeTooShort {
    // returns invalid return data for calcFee() so that abi.decode in caller will fail
    function calcFee(uint256 gasUsed_) public pure returns (uint8) {
        return uint8(21);
    }

    function requireValidAvoVersion(address avoVersion_) external pure {}

    function requireValidAvoForwarderVersion(address avoForwarderVersion_) external pure {}
}
