// SPDX-License-Identifier: MIT
pragma solidity >=0.8.17;

contract MockInvalidRegistryCalcFeeTooLong {
    // returns invalid return data for calcFee() so that abi.decode in caller will fail
    function calcFee(uint256 gasUsed_) public pure returns (uint256, address, uint256) {
        return (0.1 ether, address(1), type(uint256).max - 1);
    }

    function requireValidAvoVersion(address avoVersion_) external pure {}

    function requireValidAvoForwarderVersion(address avoForwarderVersion_) external pure {}
}
