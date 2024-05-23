// SPDX-License-Identifier: MIT
pragma solidity >=0.8.17;

contract MockInvalidRegistryCalcFeeAbuseGas {
    // returns invalid return data for calcFee() so that abi.decode in caller will fail
    function calcFee(uint256 gasUsed_) public pure returns (uint256, address) {
        // use up all gas
        while (true) {}

        return (uint256(21), address(1));
    }

    function requireValidAvoVersion(address avoVersion_) external pure {}

    function requireValidAvoForwarderVersion(address avoForwarderVersion_) external pure {}
}
