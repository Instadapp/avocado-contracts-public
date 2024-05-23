// SPDX-License-Identifier: MIT
pragma solidity >=0.8.18;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20Token is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {
        _mint(msg.sender, 1e18 * 1e18);
    }

    function mint() external {
        _mint(msg.sender, 1e18 * 1e18);
    }
}
