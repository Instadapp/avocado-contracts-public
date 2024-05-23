// SPDX-License-Identifier: MIT
pragma solidity >=0.8.18;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/// @dev This is an auxiliary contract used to set up immutable config values of Avocado contracts at deployment
///      without influencing deterministic address (constructor args).
///      Once values have been set up correctly, owner could `renounceOwnership`.
///      Expected owner is AvoMultisigAdmin contract.
contract AvoConfigV1 is Ownable {
    struct AvocadoMultisigConfig {
        /// @param authorizedMinFee_       minimum for fee charged via `castAuthorized()` to charge if
        ///                                `AvoRegistry.calcFee()` would fail.
        uint256 authorizedMinFee;
        /// @param authorizedMaxFee_       maximum for fee charged via `castAuthorized()`. If AvoRegistry
        ///                                returns a fee higher than this, then `authorizedMaxFee_` is charged as fee instead.
        uint256 authorizedMaxFee;
        /// @param authorizedFeeCollector_ address that the fee charged via `castAuthorized()` is sent to in the fallback case.
        address authorizedFeeCollector;
    }

    struct AvoDepositManagerConfig {
        address depositToken;
    }

    struct AvoSignersListConfig {
        bool trackInStorage;
    }

    event ConfigSet(
        AvocadoMultisigConfig avocadoMultisigConfig,
        AvoDepositManagerConfig avoDepositManagerConfig,
        AvoSignersListConfig avoSignersListConfig
    );

    error AvoConfig__InvalidConfig();

    AvocadoMultisigConfig public avocadoMultisigConfig;
    AvoDepositManagerConfig public avoDepositManagerConfig;
    AvoSignersListConfig public avoSignersListConfig;

    constructor(address owner_) {
        _transferOwnership(owner_);
    }

    function setConfig(
        AvocadoMultisigConfig calldata avocadoMultisigConfig_,
        AvoDepositManagerConfig calldata avoDepositManagerConfig_,
        AvoSignersListConfig calldata avoSignersListConfig_
    ) external onlyOwner {
        // min & max fee settings, fee collector address are required
        if (
            avocadoMultisigConfig_.authorizedMinFee == 0 ||
            avocadoMultisigConfig_.authorizedMaxFee == 0 ||
            avocadoMultisigConfig_.authorizedFeeCollector == address(0) ||
            avocadoMultisigConfig_.authorizedMinFee > avocadoMultisigConfig_.authorizedMaxFee
        ) {
            revert AvoConfig__InvalidConfig();
        }
        avocadoMultisigConfig = avocadoMultisigConfig_;

        if (avoDepositManagerConfig_.depositToken == address(0)) {
            revert AvoConfig__InvalidConfig();
        }
        avoDepositManagerConfig = avoDepositManagerConfig_;

        avoSignersListConfig = avoSignersListConfig_;
    }
}
