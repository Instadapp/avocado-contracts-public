// SPDX-License-Identifier: MIT
pragma solidity >=0.8.17;

contract MockSelfDestruct {
    function selfDestruct(address receiver) public {
        selfdestruct(payable(receiver)); // Sends all remaining Ether stored in the contract to the receiver and destroys the contract
    }
}
