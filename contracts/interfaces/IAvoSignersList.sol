// SPDX-License-Identifier: MIT
pragma solidity >=0.8.18;

interface IAvoSignersList {
    /// @notice adds mappings of `addSigners_` to an Avocado `avocado_`.
    ///         checks the data present at the Avocado to validate input data.
    ///
    /// If `trackInStorage` flag is set to false, then only an event will be emitted for off-chain tracking.
    /// The contract itself will not track avocados per signer on-chain!
    ///
    /// Silently ignores `addSigners_` that are already added
    ///
    /// There is expectedly no need for this method to be called by anyone other than the Avocado itself.
    function syncAddAvoSignerMappings(address avocado_, address[] calldata addSigners_) external;

    /// @notice removes mappings of `removeSigners_` from an Avocado `avocado_`.
    ///         checks the data present at the Avocado to validate input data.
    ///
    /// If `trackInStorage` flag is set to false, then only an event will be emitted for off-chain tracking.
    /// The contract itself will not track avocados per signer on-chain!
    ///
    /// Silently ignores `removeSigners_` that are already removed
    ///
    /// There is expectedly no need for this method to be called by anyone other than the Avocado itself.
    function syncRemoveAvoSignerMappings(address avocado_, address[] calldata removeSigners_) external;
}
