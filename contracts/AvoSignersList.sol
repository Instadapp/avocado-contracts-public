// SPDX-License-Identifier: MIT
pragma solidity >=0.8.18;

import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import { Address } from "@openzeppelin/contracts/utils/Address.sol";

import { IAvocadoMultisigV1 } from "./interfaces/IAvocadoMultisigV1.sol";
import { IAvoFactory } from "./interfaces/IAvoFactory.sol";
import { IAvoSignersList } from "./interfaces/IAvoSignersList.sol";
import { IAvoConfigV1 } from "./interfaces/IAvoConfigV1.sol";

// empty interface used for Natspec docs for nice layout in automatically generated docs:
//
/// @title  AvoSignersList v1.1.0
/// @notice Tracks allowed signers for Avocados, making available a list of all signers
/// linked to an Avocado or all Avocados for a certain signer address.
///
/// If `trackInStorage` flag is set to false, then only an event will be emitted for off-chain tracking.
/// The contract itself will not track avocados per signer!
///
/// Upgradeable through AvoSignersListProxy
///
/// _@dev Notes:_
/// In off-chain tracking, make sure to check for duplicates (i.e. mapping already exists).
/// This should not happen but when not tracking the data on-chain there is no way to be sure.
interface AvoSignersList_V1 {}

abstract contract AvoSignersListErrors {
    /// @notice thrown when a method is called with invalid params (e.g. zero address)
    error AvoSignersList__InvalidParams();

    /// @notice thrown when a view method is called that would require storage mapping data,
    /// but the flag `trackInStorage` is set to false and thus data is not available.
    error AvoSignersList__NotTracked();
}

abstract contract AvoSignersListConstants is AvoSignersListErrors {
    /// @notice AvoFactory used to confirm that an address is an Avocado smart wallet
    IAvoFactory public immutable avoFactory;

    /// @notice flag to signal if tracking should happen in storage or only events should be emitted (for off-chain).
    /// This can be set to false to reduce gas cost on expensive chains
    bool public immutable trackInStorage;

    /// @notice constructor sets the immutable `avoFactory` (proxy) address and the `trackInStorage` flag
    constructor(IAvoFactory avoFactory_, IAvoConfigV1 avoConfigV1_) {
        if (address(avoFactory_) == address(0)) {
            revert AvoSignersList__InvalidParams();
        }
        avoFactory = avoFactory_;

        // get trackInStorage flag from AvoConfigV1 contract
        IAvoConfigV1.AvoSignersListConfig memory avoConfig_ = avoConfigV1_.avoSignersListConfig();
        trackInStorage = avoConfig_.trackInStorage;
    }
}

abstract contract AvoSignersListVariables is AvoSignersListConstants {
    using EnumerableSet for EnumerableSet.AddressSet;

    /// @dev add a gap for slot 0 to 100 to easily inherit Initializable / OwnableUpgradeable etc. later on
    uint256[101] private __gap;

    // ---------------- slot 101 -----------------

    /// @notice tracks all Avocados mapped to a signer: signer => EnumerableSet Avocados list
    /// @dev mappings to a struct with a mapping can not be public because the getter function that Solidity automatically
    /// generates for public variables cannot handle the potentially infinite size caused by mappings within the structs.
    mapping(address => EnumerableSet.AddressSet) internal _avocadosPerSigner;
}

abstract contract AvoSignersListEvents {
    /// @notice emitted when a new signer <> Avocado mapping is added
    event SignerMappingAdded(address signer, address avocado);

    /// @notice emitted when a signer <> Avocado mapping is removed
    event SignerMappingRemoved(address signer, address avocado);
}

abstract contract AvoSignersListViews is AvoSignersListVariables {
    using EnumerableSet for EnumerableSet.AddressSet;

    /// @notice returns true if `signer_` is an allowed signer of `avocado_`
    function isSignerOf(address avocado_, address signer_) public view returns (bool) {
        // make sure avocado_ is an actual Avocado
        if (!avoFactory.isAvocado(avocado_)) {
            return false;
        }

        if (!trackInStorage) {
            return IAvocadoMultisigV1(avocado_).isSigner(signer_);
        }

        return _avocadosPerSigner[signer_].contains(avocado_);
    }

    /// @notice returns all signers for a certain `avocado_`
    function signers(address avocado_) public view returns (address[] memory) {
        // make sure avocado_ is an actual Avocado
        if (!avoFactory.isAvocado(avocado_)) {
            return new address[](0);
        }

        return IAvocadoMultisigV1(avocado_).signers();
    }

    /// @notice returns all Avocados for a certain `signer_'.
    /// reverts with `AvoSignersList__NotTracked()` if `trackInStorage` is set to false (data not available)
    function avocados(address signer_) public view returns (address[] memory) {
        if (!trackInStorage) {
            revert AvoSignersList__NotTracked();
        }

        return _avocadosPerSigner[signer_].values();
    }

    /// @notice returns the number of mapped signers for a certain `avocado_'
    function signersCount(address avocado_) public view returns (uint256) {
        // make sure avocado_ is an actual Avocado
        if (!avoFactory.isAvocado(avocado_)) {
            return 0;
        }

        return IAvocadoMultisigV1(avocado_).signersCount();
    }

    /// @notice returns the number of mapped avocados for a certain `signer_'
    /// reverts with `AvoSignersList__NotTracked()` if `trackInStorage` is set to false (data not available)
    function avocadosCount(address signer_) public view returns (uint256) {
        if (!trackInStorage) {
            revert AvoSignersList__NotTracked();
        }

        return _avocadosPerSigner[signer_].length();
    }
}

contract AvoSignersList is
    AvoSignersListErrors,
    AvoSignersListConstants,
    AvoSignersListVariables,
    AvoSignersListEvents,
    AvoSignersListViews,
    IAvoSignersList
{
    using EnumerableSet for EnumerableSet.AddressSet;

    /// @notice constructor sets the immutable `avoFactory` (proxy) address and the `trackInStorage` flag
    constructor(
        IAvoFactory avoFactory_,
        IAvoConfigV1 avoConfigV1_
    ) AvoSignersListConstants(avoFactory_, avoConfigV1_) {}

    /// @inheritdoc IAvoSignersList
    function syncAddAvoSignerMappings(address avocado_, address[] calldata addSigners_) external {
        // make sure avocado_ is an actual Avocado
        if (!avoFactory.isAvocado(avocado_)) {
            revert AvoSignersList__InvalidParams();
        }

        uint256 addSignersLength_ = addSigners_.length;
        if (addSignersLength_ == 1) {
            // if adding just one signer, using `isSigner()` is cheaper than looping through allowed signers here
            if (IAvocadoMultisigV1(avocado_).isSigner(addSigners_[0])) {
                if (trackInStorage) {
                    // `.add()` method also checks if signer is already mapped to the address
                    if (_avocadosPerSigner[addSigners_[0]].add(avocado_)) {
                        emit SignerMappingAdded(addSigners_[0], avocado_);
                    }
                    // else ignore silently if mapping is already present
                } else {
                    emit SignerMappingAdded(addSigners_[0], avocado_);
                }
            } else {
                revert AvoSignersList__InvalidParams();
            }
        } else {
            // get actual signers present at AvocadoMultisig to make sure data here will be correct
            address[] memory allowedSigners_ = IAvocadoMultisigV1(avocado_).signers();
            uint256 allowedSignersLength_ = allowedSigners_.length;
            // track last allowed signer index for loop performance improvements
            uint256 lastAllowedSignerIndex_ = 0;

            // keeping `isAllowedSigner_` outside the loop so it is not re-initialized in each loop -> cheaper
            bool isAllowedSigner_ = false;
            for (uint256 i; i < addSignersLength_; ) {
                // because allowedSigners_ and addSigners_ must be ordered ascending, the for loop can be optimized
                // each new cycle to start from the position where the last signer has been found
                for (uint256 j = lastAllowedSignerIndex_; j < allowedSignersLength_; ) {
                    if (allowedSigners_[j] == addSigners_[i]) {
                        isAllowedSigner_ = true;
                        lastAllowedSignerIndex_ = j + 1; // set to j+1 so that next cycle starts at next array position
                        break;
                    }

                    // could be optimized by checking if allowedSigners_[j] > recoveredSigners_[i]
                    // and immediately skipping with a `break;` if so. Because that implies that the recoveredSigners_[i]
                    // can not be present in allowedSigners_ due to ascending sort.
                    // But that would optimize the failing invalid case and increase cost for the default case where
                    // the input data is valid -> skip.

                    unchecked {
                        ++j;
                    }
                }

                // validate signer trying to add mapping for is really allowed at AvocadoMultisig
                if (!isAllowedSigner_) {
                    revert AvoSignersList__InvalidParams();
                } else {
                    // reset `isAllowedSigner_` for next loop
                    isAllowedSigner_ = false;
                }

                if (trackInStorage) {
                    // `.add()` method also checks if signer is already mapped to the address
                    if (_avocadosPerSigner[addSigners_[i]].add(avocado_)) {
                        emit SignerMappingAdded(addSigners_[i], avocado_);
                    }
                    // else ignore silently if mapping is already present
                } else {
                    emit SignerMappingAdded(addSigners_[i], avocado_);
                }

                unchecked {
                    ++i;
                }
            }
        }
    }

    /// @inheritdoc IAvoSignersList
    function syncRemoveAvoSignerMappings(address avocado_, address[] calldata removeSigners_) external {
        uint256 removeSignersLength_ = removeSigners_.length;

        // make sure `avocado_` is an actual Avocado
        if (!avoFactory.isAvocado(avocado_)) {
            if (trackInStorage) {
                // Avocado could have been self-destructed. remove any mapping that might still exist for input data
                bool removedAny_ = false;
                for (uint256 i; i < removeSignersLength_; ) {
                    // `.remove()` method also checks if signer is not mapped to the address
                    if (_avocadosPerSigner[removeSigners_[i]].remove(avocado_)) {
                        emit SignerMappingRemoved(removeSigners_[i], avocado_);

                        removedAny_ = true;
                    }

                    unchecked {
                        ++i;
                    }
                }
                if (removedAny_) {
                    return;
                }
            }

            revert AvoSignersList__InvalidParams();
        }

        if (removeSignersLength_ == 1) {
            // if removing just one signer, using `isSigner()` is cheaper than looping through allowed signers here
            if (IAvocadoMultisigV1(avocado_).isSigner(removeSigners_[0])) {
                revert AvoSignersList__InvalidParams();
            } else {
                if (trackInStorage) {
                    // `.remove()` method also checks if signer is not mapped to the address
                    if (_avocadosPerSigner[removeSigners_[0]].remove(avocado_)) {
                        emit SignerMappingRemoved(removeSigners_[0], avocado_);
                    }
                    // else ignore silently if mapping is not present
                } else {
                    emit SignerMappingRemoved(removeSigners_[0], avocado_);
                }
            }
        } else {
            // get actual signers present at AvocadoMultisig to make sure data here will be correct
            address[] memory allowedSigners_ = IAvocadoMultisigV1(avocado_).signers();
            uint256 allowedSignersLength_ = allowedSigners_.length;
            // track last signer index where signer to be removed was > allowedSigners for loop performance improvements
            uint256 lastSkipSignerIndex_ = 0;

            for (uint256 i; i < removeSignersLength_; ) {
                for (uint256 j = lastSkipSignerIndex_; j < allowedSignersLength_; ) {
                    if (allowedSigners_[j] == removeSigners_[i]) {
                        // validate signer trying to remove mapping for is really not present at AvocadoMultisig
                        revert AvoSignersList__InvalidParams();
                    }

                    if (allowedSigners_[j] > removeSigners_[i]) {
                        // because allowedSigners_ and removeSigners_ must be ordered ascending the for loop can be optimized:
                        // there is no need to search further once the signer to be removed is < than the allowed signer.
                        // and the next cycle can start from that position
                        lastSkipSignerIndex_ = j;
                        break;
                    }

                    unchecked {
                        ++j;
                    }
                }

                if (trackInStorage) {
                    // `.remove()` method also checks if signer is not mapped to the address
                    if (_avocadosPerSigner[removeSigners_[i]].remove(avocado_)) {
                        emit SignerMappingRemoved(removeSigners_[i], avocado_);
                    }
                    // else ignore silently if mapping is not present
                } else {
                    emit SignerMappingRemoved(removeSigners_[i], avocado_);
                }

                unchecked {
                    ++i;
                }
            }
        }
    }
}
