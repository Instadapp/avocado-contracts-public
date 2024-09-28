// SPDX-License-Identifier: MIT
pragma solidity >=0.8.18;

import { IAvoFactory } from "./IAvoFactory.sol";

interface IAvoForwarder {
    /// @notice returns the AvoFactory (proxy) address
    function avoFactory() external view returns (IAvoFactory);
}
