// SPDX-License-Identifier: MIT
pragma solidity >=0.8.18;

import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";

/// @title    AvoRegistryProxy
/// @notice   Default ERC1967Proxy for AvoRegistryProxy
contract AvoRegistryProxy is TransparentUpgradeableProxy {
    constructor(
        address logic_,
        address admin_,
        bytes memory data_
    ) payable TransparentUpgradeableProxy(logic_, admin_, data_) {}
}
