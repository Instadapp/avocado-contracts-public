// SPDX-License-Identifier: MIT
pragma solidity >=0.8.18;

import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockDeposit {
    using SafeERC20 for IERC20;

    event Deposit(address indexed from, uint256 indexed amount);
    event Withdraw(address indexed to, uint256 indexed amount);

    IERC20 public asset;

    constructor(IERC20 _asset) {
        asset = _asset;
    }

    function deposit(uint256 amount_) external {
        asset.safeTransferFrom(msg.sender, address(this), amount_);
        emit Deposit(msg.sender, amount_);
    }

    function withdraw(uint256 amount_) external {
        asset.safeTransfer(msg.sender, amount_);
        emit Withdraw(msg.sender, amount_);
    }
}
