// SPDX-License-Identifier: MIT
pragma solidity >=0.8.18;

interface IAvoConfigV1 {
    struct AvocadoMultisigConfig {
        ///
        /// @param authorizedMinFee_       minimum for fee charged via `castAuthorized()` to charge if
        ///                                `AvoRegistry.calcFee()` would fail.
        uint256 authorizedMinFee;
        ///
        /// @param authorizedMaxFee_       maximum for fee charged via `castAuthorized()`. If AvoRegistry
        ///                                returns a fee higher than this, then `authorizedMaxFee_` is charged as fee instead.
        uint256 authorizedMaxFee;
        ///
        /// @param authorizedFeeCollector_ address that the fee charged via `castAuthorized()` is sent to in the fallback case.
        address authorizedFeeCollector;
    }

    struct AvoDepositManagerConfig {
        address depositToken;
    }

    struct AvoSignersListConfig {
        bool trackInStorage;
    }

    /// @notice config for AvocadoMultisig
    function avocadoMultisigConfig() external view returns (AvocadoMultisigConfig memory);

    /// @notice config for AvoDepositManager
    function avoDepositManagerConfig() external view returns (AvoDepositManagerConfig memory);

    /// @notice config for AvoSignersList
    function avoSignersListConfig() external view returns (AvoSignersListConfig memory);
}
