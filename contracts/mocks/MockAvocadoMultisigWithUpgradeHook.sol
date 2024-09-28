// SPDX-License-Identifier: MIT
pragma solidity >=0.8.17;

import { AvocadoMultisig } from "../AvocadoMultisig/AvocadoMultisig.sol";
import { IAvoRegistry } from "../interfaces/IAvoRegistry.sol";
import { IAvoSignersList } from "../interfaces/IAvoSignersList.sol";
import { IAvoConfigV1 } from "../interfaces/IAvoConfigV1.sol";
import { IAvocadoMultisigV1Secondary } from "../interfaces/IAvocadoMultisigV1Secondary.sol";

contract MockAvocadoMultisigWithUpgradeHook is AvocadoMultisig {
    event MockAfterUpgradeHook(address fromImplementation, bytes data);

    bool internal immutable _modeRevert;

    /***********************************|
    |    CONSTRUCTOR / INITIALIZERS     |
    |__________________________________*/

    /// @notice                        constructor sets multiple immutable values for contracts and payFee fallback logic.
    /// @param avoRegistry_            address of the avoRegistry (proxy) contract
    /// @param avoForwarder_           address of the avoForwarder (proxy) contract
    ///                                to forward tx with valid signatures. must be valid version in AvoRegistry.
    /// @param avoSignersList_         address of the AvoSignersList (proxy) contract
    /// @param avoConfigV1_            AvoConfigV1 contract holding values for authorizedFee values
    /// @param modeRevert_             enable revert for mock call
    /// @param secondary_              AvocadoMultisigSecondary contract
    constructor(
        IAvoRegistry avoRegistry_,
        address avoForwarder_,
        IAvoSignersList avoSignersList_,
        IAvoConfigV1 avoConfigV1_,
        bool modeRevert_,
        IAvocadoMultisigV1Secondary secondary_
    ) AvocadoMultisig(avoRegistry_, avoForwarder_, avoSignersList_, avoConfigV1_, secondary_) {
        _modeRevert = modeRevert_;
    }

    function _afterUpgradeHook(address fromImplementation_, bytes calldata data_) public override {
        if (_modeRevert) {
            revert();
        } else {
            emit MockAfterUpgradeHook(fromImplementation_, data_);
        }
    }
}
