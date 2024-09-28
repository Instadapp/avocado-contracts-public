// SPDX-License-Identifier: MIT
pragma solidity >=0.8.18;

import { IAvoRegistry } from "./IAvoRegistry.sol";

interface IAvoFactory {
    /// @notice returns AvoRegistry (proxy) address
    function avoRegistry() external view returns (IAvoRegistry);

    /// @notice returns Avocado logic contract address that new Avocado deployments point to
    function avoImpl() external view returns (address);

    /// @notice                 Checks if a certain address is an Avocado smart wallet.
    ///                         Only works for already deployed wallets.
    /// @param avoSmartWallet_  address to check
    /// @return                 true if address is an Avocado
    function isAvocado(address avoSmartWallet_) external view returns (bool);

    /// @notice                     Computes the deterministic Avocado address for `owner_` based on Create2
    /// @param owner_               Avocado owner
    /// @param index_               index number of Avocado for `owner_` EOA
    /// @return computedAddress_    computed address for the Avocado contract
    function computeAvocado(address owner_, uint32 index_) external view returns (address computedAddress_);

    /// @notice         Deploys an Avocado for a certain `owner_` deterministcally using Create2.
    ///                 Does not check if contract at address already exists (AvoForwarder does that)
    /// @param owner_   Avocado owner
    /// @param index_   index number of Avocado for `owner_` EOA
    /// @return         deployed address for the Avocado contract
    function deploy(address owner_, uint32 index_) external returns (address);

    /// @notice                    Deploys an Avocado with non-default version for an `owner_`
    ///                            deterministcally using Create2.
    ///                            Does not check if contract at address already exists (AvoForwarder does that)
    /// @param owner_              Avocado owner
    /// @param index_              index number of Avocado for `owner_` EOA
    /// @param avoVersion_         Version of Avocado logic contract to deploy
    /// @return                    deployed address for the Avocado contract
    function deployWithVersion(address owner_, uint32 index_, address avoVersion_) external returns (address);

    /// @notice                 registry can update the current Avocado implementation contract set as default
    ///                         `_avoImpl` logic contract address for new deployments
    /// @param avoImpl_ the new avoImpl address
    function setAvoImpl(address avoImpl_) external;

    /// @notice returns the bytecode (hash) for the Avocado contract used for Create2 address computation
    function avocadoBytecode() external view returns (bytes32);
}
