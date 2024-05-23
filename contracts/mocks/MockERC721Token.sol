// SPDX-License-Identifier: MIT
pragma solidity >=0.8.18;

import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract MockERC721Token is ERC721 {
    constructor(string memory name_, string memory symbol_) ERC721(name_, symbol_) {
        // mint 100 nfts to msg.sender
        for (uint256 i; i < 100; ++i) {
            _safeMint(msg.sender, i);
        }
    }
}
