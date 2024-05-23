// SPDX-License-Identifier: MIT
pragma solidity >=0.8.18;

interface IAvoFeeCollector {
    /// @notice fee config params used to determine the fee for Avocado smart wallet `castAuthorized()` calls
    struct FeeConfig {
        ///
        /// @param feeCollector address that the fee should be paid to
        address payable feeCollector;
        ///
        /// @param mode current fee mode: 0 = percentage fee (gas cost markup); 1 = static fee (better for L2)
        uint8 mode;
        ///
        /// @param fee current fee amount:
        /// - for mode percentage: fee in 1e6 percentage (1e8 = 100%, 1e6 = 1%)
        /// - for static mode: absolute amount in native gas token to charge
        ///                    (max value 30_9485_009,821345068724781055 in 1e18)
        uint88 fee;
    }

    /// @notice calculates the `feeAmount_` for an Avocado (`msg.sender`) transaction `gasUsed_` based on
    ///         fee configuration present on the contract
    /// @param  gasUsed_       amount of gas used, required if mode is percentage. not used if mode is static fee.
    /// @return feeAmount_    calculated fee amount to be paid
    /// @return feeCollector_ address to send the fee to
    function calcFee(uint256 gasUsed_) external view returns (uint256 feeAmount_, address payable feeCollector_);
}

interface IAvoRegistry is IAvoFeeCollector {
    /// @notice                      checks if an address is listed as allowed AvoForwarder version, reverts if not.
    /// @param avoForwarderVersion_  address of the AvoForwarder logic contract to check
    function requireValidAvoForwarderVersion(address avoForwarderVersion_) external view;

    /// @notice                     checks if an address is listed as allowed Avocado version, reverts if not.
    /// @param avoVersion_          address of the Avocado logic contract to check
    function requireValidAvoVersion(address avoVersion_) external view;
}
