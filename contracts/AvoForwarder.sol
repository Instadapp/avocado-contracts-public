// SPDX-License-Identifier: MIT
pragma solidity >=0.8.18;

import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import { IAvoFactory } from "./interfaces/IAvoFactory.sol";
import { IAvoForwarder } from "./interfaces/IAvoForwarder.sol";
import { IAvocadoMultisigV1 } from "./interfaces/IAvocadoMultisigV1.sol";

// empty interface used for Natspec docs for nice layout in automatically generated docs:
//
/// @title  AvoForwarder v1.1.0
/// @notice Handles executing authorized actions (through signatures) at Avocados, triggered by allow-listed broadcasters.
/// @dev Only compatible with forwarding `cast` calls to Avocado smart wallet contracts.
/// This is not a generic forwarder.
/// This is NOT a "TrustedForwarder" as proposed in EIP-2770, see info in Avocado smart wallet contracts.
///
/// Does not validate the EIP712 signature (instead this is done in the smart wallet itself).
///
/// Upgradeable through AvoForwarderProxy
interface AvoForwarder_V1 {}

abstract contract AvoForwarderConstants is IAvoForwarder {
    /// @notice AvoFactory (proxy) used to deploy new Avocado smart wallets.
    //
    // @dev     If this changes then the deployment addresses for Avocado smart wallets change too. A more complex
    //          system with versioning would have to be implemented then for most methods.
    IAvoFactory public immutable avoFactory;

    /// @notice cached Avocado Bytecode to directly compute address in this contract to optimize gas usage.
    //
    // @dev If this changes because of an Avocado change (and AvoFactory upgrade),
    // then this variable must be updated through an upgrade, deploying a new AvoForwarder!
    bytes32 public constant avocadoBytecode = 0x6b106ae0e3afae21508569f62d81c7d826b900a2e9ccc973ba97abfae026fc54;

    /// @dev amount of gas to keep in cast caller method as reserve for emitting Executed / ExecuteFailed event.
    /// ~6920 gas + buffer. the dynamic part is covered with EMIT_EVENT_COST_PER_BYTE (for metadata).
    uint256 internal constant EVENTS_RESERVE_GAS = 8_500;

    /// @dev emitting one byte in an event costs 8 byte see https://github.com/wolflo/evm-opcodes/blob/main/gas.md#a8-log-operations
    uint256 internal constant EMIT_EVENT_COST_PER_BYTE = 8;

    constructor(IAvoFactory avoFactory_) {
        avoFactory = avoFactory_;
    }
}

abstract contract AvoForwarderVariables is AvoForwarderConstants, Initializable, OwnableUpgradeable {
    // @dev variables here start at storage slot 101, before is:
    // - Initializable with storage slot 0:
    // uint8 private _initialized;
    // bool private _initializing;
    // - OwnableUpgradeable with slots 1 to 100:
    // uint256[50] private __gap; (from ContextUpgradeable, slot 1 until slot 50)
    // address private _owner; (at slot 51)
    // uint256[49] private __gap; (slot 52 until slot 100)

    // ---------------- slot 101 -----------------

    /// @notice allowed broadcasters that can call `execute()` methods. allowed if set to `1`
    mapping(address => uint256) internal _broadcasters;

    // ---------------- slot 102 -----------------

    /// @notice allowed auths. allowed if set to `1`
    mapping(address => uint256) internal _auths;
}

abstract contract AvoForwarderErrors {
    /// @notice thrown when a method is called with invalid params (e.g. zero address)
    error AvoForwarder__InvalidParams();

    /// @notice thrown when a caller is not authorized to execute a certain action
    error AvoForwarder__Unauthorized();

    /// @notice thrown when trying to execute legacy methods for a not yet deployed Avocado smart wallet
    error AvoForwarder__LegacyVersionNotDeployed();

    /// @notice thrown when an unsupported method is called (e.g. renounceOwnership)
    error AvoForwarder__Unsupported();
}

abstract contract AvoForwarderStructs {
    /// @notice struct mapping an address value to a boolean flag.
    //
    // @dev when used as input param, removes need to make sure two input arrays are of same length etc.
    struct AddressBool {
        address addr;
        bool value;
    }

    struct ExecuteBatchParams {
        address from;
        uint32 index;
        IAvocadoMultisigV1.CastChainAgnosticParams params;
        IAvocadoMultisigV1.SignatureParams[] signaturesParams;
        IAvocadoMultisigV1.ChainAgnosticHash[] chainAgnosticHashes;
    }

    struct SimulateBatchResult {
        uint256 castGasUsed;
        bool success;
        string revertReason;
    }
}

abstract contract AvoForwarderEvents is AvoForwarderStructs {
    /// @notice emitted when all actions for `cast()` in an `execute()` method are executed successfully
    event Executed(
        address indexed avocadoOwner,
        uint32 index,
        address indexed avocadoAddress,
        address indexed source,
        bytes metadata
    );

    /// @notice emitted if one of the actions for `cast()` in an `execute()` method fails
    event ExecuteFailed(
        address indexed avocadoOwner,
        uint32 index,
        address indexed avocadoAddress,
        address indexed source,
        bytes metadata,
        string reason
    );

    /// @notice emitted if a broadcaster's allowed status is updated
    event BroadcasterUpdated(address indexed broadcaster, bool indexed status);

    /// @notice emitted if an auth's allowed status is updated
    event AuthUpdated(address indexed auth, bool indexed status);
}

abstract contract AvoForwarderCore is
    AvoForwarderConstants,
    AvoForwarderVariables,
    AvoForwarderStructs,
    AvoForwarderEvents,
    AvoForwarderErrors
{
    /***********************************|
    |             MODIFIERS             |
    |__________________________________*/

    /// @dev checks if `msg.sender` is an allowed broadcaster
    modifier onlyBroadcaster() {
        if (_broadcasters[msg.sender] != 1) {
            revert AvoForwarder__Unauthorized();
        }
        _;
    }

    /// @dev checks if an address is not the zero address
    modifier validAddress(address _address) {
        if (_address == address(0)) {
            revert AvoForwarder__InvalidParams();
        }
        _;
    }

    /***********************************|
    |            CONSTRUCTOR            |
    |__________________________________*/

    constructor(IAvoFactory avoFactory_) validAddress(address(avoFactory_)) AvoForwarderConstants(avoFactory_) {
        // Ensure logic contract initializer is not abused by disabling initializing
        // see https://forum.openzeppelin.com/t/security-advisory-initialize-uups-implementation-contracts/15301
        // and https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#initializing_the_implementation_contract
        _disableInitializers();
    }

    /***********************************|
    |              INTERNAL             |
    |__________________________________*/

    /// @dev gets or if necessary deploys an Avocado for owner `from_` and `index_` and returns the address
    function _getDeployedAvocado(address from_, uint32 index_) internal returns (address) {
        address computedAvocadoAddress_ = _computeAvocado(from_, index_);
        if (Address.isContract(computedAvocadoAddress_)) {
            return computedAvocadoAddress_;
        } else {
            return avoFactory.deploy(from_, index_);
        }
    }

    /// @dev executes `_getDeployedAvocado` with gas measurements
    function _getSimulateDeployedAvocado(
        address from_,
        uint32 index_
    ) internal returns (IAvocadoMultisigV1 avocado_, uint256 deploymentGasUsed_, bool isDeployed_) {
        if (msg.sender != 0x000000000000000000000000000000000000dEaD) {
            revert AvoForwarder__Unauthorized();
        }

        uint256 gasSnapshotBefore_ = gasleft();
        // `_getDeployedAvocado()` automatically checks if Avocado has to be deployed
        // or if it already exists and simply returns the address in that case
        avocado_ = IAvocadoMultisigV1(_getDeployedAvocado(from_, index_));
        deploymentGasUsed_ = gasSnapshotBefore_ - gasleft();

        isDeployed_ = deploymentGasUsed_ < 100_000; // avocado for sure not yet deployed if gas used > 100k
        // (deployment costs > 200k)
    }

    /// @dev computes the deterministic contract address for an Avocado deployment for `owner_` and `index_`
    function _computeAvocado(address owner_, uint32 index_) internal view returns (address computedAddress_) {
        // replicate Create2 address determination logic
        bytes32 hash = keccak256(
            abi.encodePacked(bytes1(0xff), address(avoFactory), _getSalt(owner_, index_), avocadoBytecode)
        );

        // cast last 20 bytes of hash to address via low level assembly
        assembly {
            computedAddress_ := and(hash, 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF)
        }
    }

    /// @dev gets the bytes32 salt used for deterministic Avocado deployment for `owner_` and `index_`, same as on AvoFactory
    function _getSalt(address owner_, uint32 index_) internal pure returns (bytes32) {
        // use owner + index of avocado nr per EOA (plus "type", currently always 0)
        // Note CREATE2 deployments take into account the deployers address (i.e. this factory address)
        return keccak256(abi.encode(owner_, index_, 0));
    }

    /// @dev returns the dynamic reserve gas to be kept back for emitting the Executed or ExecuteFailed event
    function _dynamicReserveGas(uint256 metadataLength_) internal pure returns (uint256 reserveGas_) {
        unchecked {
            // the gas usage for the emitting the CastExecuted/CastFailed events depends on the  metadata bytes length,
            // dynamically calculated with cost per byte for emit event
            reserveGas_ = EVENTS_RESERVE_GAS + (EMIT_EVENT_COST_PER_BYTE * metadataLength_);
        }
    }

    /// @dev Deploys Avocado for owner if necessary and calls `cast()` on it with given input params.
    function _executeV1(
        address from_,
        uint32 index_,
        IAvocadoMultisigV1.CastParams calldata params_,
        IAvocadoMultisigV1.CastForwardParams calldata forwardParams_,
        IAvocadoMultisigV1.SignatureParams[] calldata signaturesParams_
    ) internal returns (bool success_) {
        // `_getDeployedAvocado()` automatically checks if Avocado has to be deployed
        // or if it already exists and simply returns the address in that case
        IAvocadoMultisigV1 avocadoMultisig_ = IAvocadoMultisigV1(_getDeployedAvocado(from_, index_));

        string memory revertReason_;
        (success_, revertReason_) = avocadoMultisig_.cast{
            value: forwardParams_.value,
             // keep back at least enough gas to ensure we can emit events logic below. either calculated reserve gas amount
             // will be kept back or 1/64th according to EIP150 (whichever is bigger).
            gas: gasleft() - _dynamicReserveGas(params_.metadata.length)
        }(params_, forwardParams_, signaturesParams_);

        // @dev on changes in the code below this point, measure the needed reserve gas via `gasleft()` anew
        // and update the reserve gas constant amount.
        // gas measurement currently: ~6920 gas for emit event with max revertReason length
        if (success_) {
            emit Executed(from_, index_, address(avocadoMultisig_), params_.source, params_.metadata);
        } else {
            emit ExecuteFailed(
                from_,
                index_,
                address(avocadoMultisig_),
                params_.source,
                params_.metadata,
                revertReason_
            );
        }
        // @dev ending point for measuring reserve gas should be here.
    }

    /// @dev Deploys Avocado for owner if necessary and calls `castChainAgnostic()` on it with given input params.
    function _executeChainAgnosticV1(
        address from_,
        uint32 index_,
        IAvocadoMultisigV1.CastChainAgnosticParams calldata params_,
        IAvocadoMultisigV1.SignatureParams[] calldata signaturesParams_,
        IAvocadoMultisigV1.ChainAgnosticHash[] calldata chainAgnosticHashes_
    ) internal returns (bool success_) {
        // `_getDeployedAvocado()` automatically checks if Avocado has to be deployed
        // or if it already exists and simply returns the address in that case
        IAvocadoMultisigV1 avocadoMultisig_ = IAvocadoMultisigV1(_getDeployedAvocado(from_, index_));

        string memory revertReason_;
        (success_, revertReason_) = avocadoMultisig_.castChainAgnostic{ 
                value: params_.forwardParams.value,
                // keep back at least enough gas to ensure we can emit events logic below. either calculated reserve gas amount
                // will be kept back or 1/64th according to EIP150 (whichever is bigger).
                gas: gasleft() - _dynamicReserveGas(params_.params.metadata.length)
            }(
            params_,
            signaturesParams_,
            chainAgnosticHashes_
        );

        // @dev on changes below, reserve gas must be updated. see _executeV1.
        if (success_) {
            emit Executed(from_, index_, address(avocadoMultisig_), params_.params.source, params_.params.metadata);
        } else {
            emit ExecuteFailed(
                from_,
                index_,
                address(avocadoMultisig_),
                params_.params.source,
                params_.params.metadata,
                revertReason_
            );
        }
    }
}

abstract contract AvoForwarderViews is AvoForwarderCore {
    /// @notice checks if a `broadcaster_` address is an allowed broadcaster
    function isBroadcaster(address broadcaster_) external view returns (bool) {
        return _broadcasters[broadcaster_] == 1;
    }

    /// @notice checks if an `auth_` address is an allowed auth
    function isAuth(address auth_) external view returns (bool) {
        return _auths[auth_] == 1;
    }
}

abstract contract AvoForwarderViewsAvocado is AvoForwarderCore {
    /// @notice        Retrieves the current avoNonce of AvocadoMultisig for `owner_` address.
    ///                Needed for building signatures.
    /// @param owner_  Avocado owner to retrieve the nonce for.
    /// @param index_  index number of Avocado for `owner_` EOA
    /// @return        returns the avoNonce for the `owner_` necessary to sign a meta transaction
    function avoNonce(address owner_, uint32 index_) external view returns (uint256) {
        address avoAddress_ = _computeAvocado(owner_, index_);
        if (Address.isContract(avoAddress_)) {
            return IAvocadoMultisigV1(avoAddress_).avoNonce();
        }

        return 0;
    }

    /// @notice        Retrieves the current AvocadoMultisig implementation name for `owner_` address.
    ///                Needed for building signatures.
    /// @param owner_  Avocado owner to retrieve the name for.
    /// @param index_  index number of Avocado for `owner_` EOA
    /// @return        returns the domain separator name for the `owner_` necessary to sign a meta transaction
    function avocadoVersionName(address owner_, uint32 index_) external view returns (string memory) {
        address avoAddress_ = _computeAvocado(owner_, index_);
        if (Address.isContract(avoAddress_)) {
            // if AvocadoMultisig is deployed, return value from deployed contract
            return IAvocadoMultisigV1(avoAddress_).DOMAIN_SEPARATOR_NAME();
        }

        // otherwise return default value for current implementation that will be deployed
        return IAvocadoMultisigV1(avoFactory.avoImpl()).DOMAIN_SEPARATOR_NAME();
    }

    /// @notice        Retrieves the current AvocadoMultisig implementation version for `owner_` address.
    ///                Needed for building signatures.
    /// @param owner_  Avocado owner to retrieve the version for.
    /// @param index_  index number of Avocado for `owner_` EOA
    /// @return        returns the domain separator version for the `owner_` necessary to sign a meta transaction
    function avocadoVersion(address owner_, uint32 index_) external view returns (string memory) {
        address avoAddress_ = _computeAvocado(owner_, index_);
        if (Address.isContract(avoAddress_)) {
            // if AvocadoMultisig is deployed, return value from deployed contract
            return IAvocadoMultisigV1(avoAddress_).DOMAIN_SEPARATOR_VERSION();
        }

        // otherwise return default value for current implementation that will be deployed
        return IAvocadoMultisigV1(avoFactory.avoImpl()).DOMAIN_SEPARATOR_VERSION();
    }

    /// @notice Computes the deterministic Avocado address for `owner_` and `index_`
    function computeAvocado(address owner_, uint32 index_) external view returns (address) {
        if (Address.isContract(owner_)) {
            // owner of a Avocado must be an EOA, if it's a contract return zero address
            return address(0);
        }
        return _computeAvocado(owner_, index_);
    }

    /// @notice returns the hashes struct for each `CastChainAgnosticParams` element of `params_`. The returned array must be
    ///         passed into `castChainAgnostic()` as the param `chainAgnosticHashes_` there (order must be the same).
    ///         The returned hash for each element is the EIP712 type hash for `CAST_CHAIN_AGNOSTIC_PARAMS_TYPE_HASH`,
    ///         as used when the signature digest is built.
    /// @dev    Deploys the Avocado if necessary. Expected to be called with callStatic.
    function getAvocadoChainAgnosticHashes(
        address from_,
        uint32 index_,
        IAvocadoMultisigV1.CastChainAgnosticParams[] calldata params_
    ) external returns (IAvocadoMultisigV1.ChainAgnosticHash[] memory chainAgnosticHashes_) {
        // `_getDeployedAvocado()` automatically checks if Avocado has to be deployed
        // or if it already exists and simply returns the address in that case
        IAvocadoMultisigV1 avocadoMultisig_ = IAvocadoMultisigV1(_getDeployedAvocado(from_, index_));

        return avocadoMultisig_.getChainAgnosticHashes(params_);
    }
}

abstract contract AvoForwarderV1 is AvoForwarderCore {
    /// @notice                  Deploys Avocado for owner if necessary and calls `cast()` on it.
    ///                          For Avocado v1.
    ///                          Only callable by allowed broadcasters.
    /// @param from_             Avocado owner
    /// @param index_            index number of Avocado for `owner_` EOA
    /// @param params_           Cast params such as id, avoNonce and actions to execute
    /// @param forwardParams_    Cast params related to validity of forwarding as instructed and signed
    /// @param signaturesParams_ SignatureParams structs array for signature and signer:
    ///                          - signature: the EIP712 signature, 65 bytes ECDSA signature for a default EOA.
    ///                            For smart contract signatures it must fulfill the requirements for the relevant
    ///                            smart contract `.isValidSignature()` EIP1271 logic
    ///                          - signer: address of the signature signer.
    ///                            Must match the actual signature signer or refer to the smart contract
    ///                            that must be an allowed signer and validates signature via EIP1271
    function executeV1(
        address from_,
        uint32 index_,
        IAvocadoMultisigV1.CastParams calldata params_,
        IAvocadoMultisigV1.CastForwardParams calldata forwardParams_,
        IAvocadoMultisigV1.SignatureParams[] calldata signaturesParams_
    ) external payable onlyBroadcaster {
        _executeV1(from_, index_, params_, forwardParams_, signaturesParams_);
    }

    /// @notice                  Verify the transaction is valid and can be executed.
    ///                          IMPORTANT: Expected to be called via callStatic.
    ///
    ///                          Returns true if valid, reverts otherwise:
    ///                          e.g. if input params, signature or avoNonce etc. are invalid.
    /// @param from_             Avocado owner
    /// @param index_            index number of Avocado for `owner_` EOA
    /// @param params_           Cast params such as id, avoNonce and actions to execute
    /// @param forwardParams_    Cast params related to validity of forwarding as instructed and signed
    /// @param signaturesParams_ SignatureParams structs array for signature and signer:
    ///                          - signature: the EIP712 signature, 65 bytes ECDSA signature for a default EOA.
    ///                            For smart contract signatures it must fulfill the requirements for the relevant
    ///                            smart contract `.isValidSignature()` EIP1271 logic
    ///                          - signer: address of the signature signer.
    ///                            Must match the actual signature signer or refer to the smart contract
    ///                            that must be an allowed signer and validates signature via EIP1271
    /// @return                  returns true if everything is valid, otherwise reverts.
    //
    // @dev can not be marked as view because it does potentially modify state by deploying the
    //      AvocadoMultisig for `from_` if it does not exist yet. Thus expected to be called via callStatic
    function verifyV1(
        address from_,
        uint32 index_,
        IAvocadoMultisigV1.CastParams calldata params_,
        IAvocadoMultisigV1.CastForwardParams calldata forwardParams_,
        IAvocadoMultisigV1.SignatureParams[] calldata signaturesParams_
    ) external returns (bool) {
        // `_getDeployedAvocado()` automatically checks if Avocado has to be deployed
        // or if it already exists and simply returns the address in that case
        IAvocadoMultisigV1 avocadoMultisig_ = IAvocadoMultisigV1(_getDeployedAvocado(from_, index_));

        return avocadoMultisig_.verify(params_, forwardParams_, signaturesParams_);
    }
}

abstract contract AvoForwarderChainAgnosticV1 is AvoForwarderCore {
    /// @notice                     Deploys Avocado for owner if necessary and calls `castChainAgnostic()` on it.
    ///                             For Avocado v1.
    ///                             Only callable by allowed broadcasters.
    /// @param from_                Avocado owner
    /// @param index_               index number of Avocado for `owner_` EOA
    /// @param params_              Chain agnostic params containing CastParams, ForwardParams and chain id.
    ///                             Note chain id must match block.chainid.
    /// @param signaturesParams_    SignatureParams structs array for signature and signer:
    ///                             - signature: the EIP712 signature, 65 bytes ECDSA signature for a default EOA.
    ///                               For smart contract signatures it must fulfill the requirements for the relevant
    ///                               smart contract `.isValidSignature()` EIP1271 logic
    ///                             - signer: address of the signature signer.
    ///                               Must match the actual signature signer or refer to the smart contract
    ///                               that must be an allowed signer and validates signature via EIP1271
    /// @param chainAgnosticHashes_ hashes struct for each original `CastChainAgnosticParams` struct as used when signing the
    ///                             txs to be executed. Result of `.getChainAgnosticHashes()`.
    function executeChainAgnosticV1(
        address from_,
        uint32 index_,
        IAvocadoMultisigV1.CastChainAgnosticParams calldata params_,
        IAvocadoMultisigV1.SignatureParams[] calldata signaturesParams_,
        IAvocadoMultisigV1.ChainAgnosticHash[] calldata chainAgnosticHashes_
    ) external payable onlyBroadcaster {
        _executeChainAgnosticV1(from_, index_, params_, signaturesParams_, chainAgnosticHashes_);
    }

    /// @notice                     Verify the transaction is a valid chain agnostic tx and can be executed.
    ///                             IMPORTANT: Expected to be called via callStatic.
    ///
    ///                             Returns true if valid, reverts otherwise:
    ///                             e.g. if input params, signature or avoNonce etc. are invalid.
    /// @param from_                Avocado owner
    /// @param index_               index number of Avocado for `owner_` EOA
    /// @param params_              Chain agnostic params containing CastParams, ForwardParams and chain id.
    ///                             Note chain id must match block.chainid.
    /// @param signaturesParams_    SignatureParams structs array for signature and signer:
    ///                             - signature: the EIP712 signature, 65 bytes ECDSA signature for a default EOA.
    ///                               For smart contract signatures it must fulfill the requirements for the relevant
    ///                               smart contract `.isValidSignature()` EIP1271 logic
    ///                             - signer: address of the signature signer.
    ///                               Must match the actual signature signer or refer to the smart contract
    ///                               that must be an allowed signer and validates signature via EIP1271
    /// @param chainAgnosticHashes_ hashes struct for each original `CastChainAgnosticParams` struct as used when signing the
    ///                             txs to be executed. Result of `.getChainAgnosticHashes()`.
    /// @return                     returns true if everything is valid, otherwise reverts.
    //
    // @dev can not be marked as view because it does potentially modify state by deploying the
    //      AvocadoMultisig for `from_` if it does not exist yet. Thus expected to be called via callStatic
    function verifyChainAgnosticV1(
        address from_,
        uint32 index_,
        IAvocadoMultisigV1.CastChainAgnosticParams calldata params_,
        IAvocadoMultisigV1.SignatureParams[] calldata signaturesParams_,
        IAvocadoMultisigV1.ChainAgnosticHash[] calldata chainAgnosticHashes_
    ) external returns (bool) {
        // `_getDeployedAvocado()` automatically checks if Avocado has to be deployed
        // or if it already exists and simply returns the address in that case
        IAvocadoMultisigV1 avocadoMultisig_ = IAvocadoMultisigV1(_getDeployedAvocado(from_, index_));

        return avocadoMultisig_.verifyChainAgnostic(params_, signaturesParams_, chainAgnosticHashes_);
    }
}

abstract contract AvoForwarderBatchV1 is AvoForwarderCore {
    /// @notice                  Executes multiple txs as batch.
    ///                          For Avocado v1.
    ///                          Only callable by allowed broadcasters.
    /// @param batches_          Execute batch txs array, same as inputs for `executeChainAgnosticV1()` just as struct array.
    ///                          If `chainAgnosticHashes` is set (length > 0), then `executeChainAgnosticV1()` is executed,
    ///                          otherwise `executeV1()` is executed with the given array element.
    /// @param continueOnRevert_ flag to signal if one `ExecuteBatchParams` in `batches_` fails, should the rest of them
    ///                          still continue to be executed.
    function executeBatchV1(
        ExecuteBatchParams[] calldata batches_,
        bool continueOnRevert_
    ) external payable onlyBroadcaster {
        uint256 length_ = batches_.length;

        if (length_ < 2) {
            revert AvoForwarder__InvalidParams();
        }

        bool success_;
        for (uint256 i; i < length_; ) {
            if (batches_[i].chainAgnosticHashes.length > 0) {
                success_ = _executeChainAgnosticV1(
                    batches_[i].from,
                    batches_[i].index,
                    batches_[i].params,
                    batches_[i].signaturesParams,
                    batches_[i].chainAgnosticHashes
                );
            } else {
                success_ = _executeV1(
                    batches_[i].from,
                    batches_[i].index,
                    batches_[i].params.params,
                    batches_[i].params.forwardParams,
                    batches_[i].signaturesParams
                );
            }

            if (!success_ && !continueOnRevert_) {
                break;
            }

            unchecked {
                ++i;
            }
        }
    }
}

abstract contract AvoForwarderSimulateV1 is AvoForwarderCore {
    uint256 internal constant SIMULATE_WASTE_GAS_MARGIN = 10; // 10% added in used gas for simulations

    // @dev helper struct to work around Stack too deep Errors
    struct SimulationVars {
        IAvocadoMultisigV1 avocadoMultisig;
        uint256 initialGas;
    }

    /// @dev see `simulateV1()`. Reverts on `success_` = false for accurate .estimateGas() usage.
    ///                          Helpful to estimate gas for an Avocado tx. Note: resulting gas usage will usually be
    ///                          with at least ~10k gas buffer compared to actual execution.
    ///                          For Avocado v1.
    ///                          Deploys the Avocado smart wallet if necessary.
    /// @dev  Expected use with `.estimateGas()`. User signed `CastForwardParams.gas` should be set to the estimated
    ///       amount minus gas used in AvoForwarder (until AvocadoMultisig logic where the gas param is validated).
    function estimateV1(
        address from_,
        uint32 index_,
        IAvocadoMultisigV1.CastParams calldata params_,
        IAvocadoMultisigV1.CastForwardParams calldata forwardParams_,
        IAvocadoMultisigV1.SignatureParams[] calldata signaturesParams_
    ) external payable {
        (, , , bool success_, string memory revertReason_) = simulateV1(
            from_,
            index_,
            params_,
            forwardParams_,
            signaturesParams_
        );

        if (!success_) {
            revert(revertReason_);
        }
    }

    /// @notice                  Simulates a `executeV1()` tx, callable only by msg.sender = dead address
    ///                          (0x000000000000000000000000000000000000dEaD). Useful to determine success / error
    ///                          and other return values of `executeV1()` with a `.callstatic`.
    ///                          For Avocado v1.
    /// @dev                      - set `signaturesParams_` to empty to automatically simulate with required signers length.
    ///                           - if `signaturesParams_` first element signature is not set, or if first signer is set to
    ///                             0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF, then gas usage burn is simulated
    ///                             for verify signature functionality. DO NOT set signature to non-empty for subsequent
    ///                             elements then; set all signatures to empty!
    ///                           - if `signaturesParams_` is set normally, signatures are verified as in actual execute
    ///                           - buffer amounts for mock smart contract signers signature verification must be added
    ///                             off-chain as this varies on a case per case basis.
    /// @param from_             AvocadoMultisig owner
    /// @param index_            index number of Avocado for `owner_` EOA
    /// @param params_           Cast params such as id, avoNonce and actions to execute
    /// @param forwardParams_    Cast params related to validity of forwarding as instructed and signed
    /// @param signaturesParams_ SignatureParams structs array for signature and signer:
    ///                          - signature: the EIP712 signature, 65 bytes ECDSA signature for a default EOA.
    ///                            For smart contract signatures it must fulfill the requirements for the relevant
    ///                            smart contract `.isValidSignature()` EIP1271 logic
    ///                          - signer: address of the signature signer.
    ///                            Must match the actual signature signer or refer to the smart contract
    ///                            that must be an allowed signer and validates signature via EIP1271
    /// @return castGasUsed_        amount of gas used for executing `cast`
    /// @return deploymentGasUsed_  amount of gas used for deployment (or for getting the contract if already deployed)
    /// @return isDeployed_         boolean flag indicating if Avocado is already deployed
    /// @return success_            boolean flag indicating whether executing actions reverts or not
    /// @return revertReason_       revert reason original error in default format "<action_index>_error"
    function simulateV1(
        address from_,
        uint32 index_,
        IAvocadoMultisigV1.CastParams calldata params_,
        IAvocadoMultisigV1.CastForwardParams calldata forwardParams_,
        IAvocadoMultisigV1.SignatureParams[] calldata signaturesParams_
    )
        public
        payable
        returns (
            uint256 castGasUsed_,
            uint256 deploymentGasUsed_,
            bool isDeployed_,
            bool success_,
            string memory revertReason_
        )
    {
        SimulationVars memory vars_; 

        vars_.initialGas = gasleft();

        (vars_.avocadoMultisig, deploymentGasUsed_, isDeployed_) = _getSimulateDeployedAvocado(from_, index_);

        {
            uint256 gasSnapshotBefore_;
            bytes32 avoVersion_ = keccak256(bytes(vars_.avocadoMultisig.DOMAIN_SEPARATOR_VERSION()));
            if (avoVersion_ == keccak256(bytes("1.0.0")) || avoVersion_ == keccak256(bytes("1.0.1"))) {
                gasSnapshotBefore_ = gasleft();
                (success_, revertReason_) = vars_.avocadoMultisig.cast{ value: forwardParams_.value,
                // keep back at least enough gas to ensure we can emit events logic below. either calculated reserve gas amount
                // will be kept back or 1/64th according to EIP150 (whichever is bigger).
                gas: gasleft() - _dynamicReserveGas(params_.metadata.length)
             }(
                    params_,
                    forwardParams_,
                    signaturesParams_
                );
            } else {
                gasSnapshotBefore_ = gasleft();
                (success_, revertReason_) = vars_.avocadoMultisig.simulateCast{ value: forwardParams_.value, 
                    // keep back at least enough gas to ensure we can emit events logic below. either calculated reserve gas amount
                    // will be kept back or 1/64th according to EIP150 (whichever is bigger).
                    gas: gasleft() - _dynamicReserveGas(params_.metadata.length) }(
                    params_,
                    forwardParams_,
                    signaturesParams_
                );
            }
            castGasUsed_ = gasSnapshotBefore_ - gasleft();
        }

        if (success_) {
            emit Executed(from_, index_, address(vars_.avocadoMultisig), params_.source, params_.metadata);
        } else {
            emit ExecuteFailed(
                from_,
                index_,
                address(vars_.avocadoMultisig),
                params_.source,
                params_.metadata,
                revertReason_
            );
        }

        _wasteGas(((vars_.initialGas - gasleft()) * SIMULATE_WASTE_GAS_MARGIN) / 100); // e.g. 10% of used gas
    }

    /// @dev see `simulateChainAgnosticV1()`. Reverts on `success_` = false for accurate .estimateGas() usage.
    ///                          Helpful to estimate gas for an Avocado tx. Note: resulting gas usage will usually be
    ///                          with at least ~10k gas buffer compared to actual execution.
    ///                          For Avocado v1.
    ///                          Deploys the Avocado smart wallet if necessary.
    /// @dev  Expected use with `.estimateGas()`. User signed `CastForwardParams.gas` should be set to the estimated
    ///       amount minus gas used in AvoForwarder (until AvocadoMultisig logic where the gas param is validated).
    function estimateChainAgnosticV1(
        address from_,
        uint32 index_,
        IAvocadoMultisigV1.CastChainAgnosticParams calldata params_,
        IAvocadoMultisigV1.SignatureParams[] calldata signaturesParams_,
        IAvocadoMultisigV1.ChainAgnosticHash[] calldata chainAgnosticHashes_
    ) external payable {
        (, , , bool success_, string memory revertReason_) = simulateChainAgnosticV1(
            from_,
            index_,
            params_,
            signaturesParams_,
            chainAgnosticHashes_
        );

        if (!success_) {
            revert(revertReason_);
        }
    }

    /// @notice                   Simulates a `executeChainAgnosticV1()` tx, callable only by msg.sender = dead address
    ///                           (0x000000000000000000000000000000000000dEaD). Useful to determine success / error
    ///                           and other return values of `executeV1()` with a `.callstatic`.
    ///                           For Avocado v1.
    ///                           Deploys the Avocado smart wallet if necessary.
    /// @dev                      - set `signaturesParams_` to empty to automatically simulate with required signers length.
    ///                           - if `signaturesParams_` first element signature is not set, or if first signer is set to
    ///                             0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF, then gas usage burn is simulated
    ///                             for verify signature functionality. DO NOT set signature to non-empty for subsequent
    ///                             elements then; set all signatures to empty!
    ///                           - if `signaturesParams_` is set normally, signatures are verified as in actual execute
    ///                           - buffer amounts for mock smart contract signers signature verification must be added
    ///                             off-chain as this varies on a case per case basis.
    /// @param from_                Avocado owner
    /// @param index_               index number of Avocado for `owner_` EOA
    /// @param params_              Chain agnostic params containing CastParams, ForwardParams and chain id.
    ///                             Note chain id must match block.chainid.
    /// @param signaturesParams_    SignatureParams structs array for signature and signer:
    ///                             - signature: the EIP712 signature, 65 bytes ECDSA signature for a default EOA.
    ///                               For smart contract signatures it must fulfill the requirements for the relevant
    ///                               smart contract `.isValidSignature()` EIP1271 logic
    ///                             - signer: address of the signature signer.
    ///                               Must match the actual signature signer or refer to the smart contract
    ///                               that must be an allowed signer and validates signature via EIP1271
    /// @param chainAgnosticHashes_ hashes struct for each original `CastChainAgnosticParams` struct as used when signing the
    ///                             txs to be executed. Result of `.getChainAgnosticHashes()`.
    /// @return castGasUsed_        amount of gas used for executing `cast`
    /// @return deploymentGasUsed_  amount of gas used for deployment (or for getting the contract if already deployed)
    /// @return isDeployed_         boolean flag indicating if Avocado is already deployed
    /// @return success_            boolean flag indicating whether executing actions reverts or not
    /// @return revertReason_       revert reason original error in default format "<action_index>_error"
    function simulateChainAgnosticV1(
        address from_,
        uint32 index_,
        IAvocadoMultisigV1.CastChainAgnosticParams calldata params_,
        IAvocadoMultisigV1.SignatureParams[] calldata signaturesParams_,
        IAvocadoMultisigV1.ChainAgnosticHash[] calldata chainAgnosticHashes_
    )
        public
        payable
        returns (
            uint256 castGasUsed_,
            uint256 deploymentGasUsed_,
            bool isDeployed_,
            bool success_,
            string memory revertReason_
        )
    {
        SimulationVars memory vars_; 

        vars_.initialGas = gasleft();

        (vars_.avocadoMultisig, deploymentGasUsed_, isDeployed_) = _getSimulateDeployedAvocado(from_, index_);

        {
            uint256 gasSnapshotBefore_ = gasleft();
            (success_, revertReason_) = vars_.avocadoMultisig.simulateCastChainAgnostic{
                value: params_.forwardParams.value,
                // keep back at least enough gas to ensure we can emit events logic below. either calculated reserve gas amount
                // will be kept back or 1/64th according to EIP150 (whichever is bigger).
                gas: gasleft() - _dynamicReserveGas(params_.params.metadata.length)
            }(params_, signaturesParams_, chainAgnosticHashes_);
            castGasUsed_ = gasSnapshotBefore_ - gasleft();
        }

        if (success_) {
            emit Executed(from_, index_, address(vars_.avocadoMultisig), params_.params.source, params_.params.metadata);
        } else {
            emit ExecuteFailed(
                from_,
                index_,
                address(vars_.avocadoMultisig),
                params_.params.source,
                params_.params.metadata,
                revertReason_
            );
        }

        _wasteGas(((vars_.initialGas - gasleft()) * SIMULATE_WASTE_GAS_MARGIN) / 100); // e.g. 10% of used gas
    }

    /// @notice                  Simulates a `executeBatchV1()` tx, callable only by msg.sender = dead address
    ///                          (0x000000000000000000000000000000000000dEaD)
    ///                          Helpful to estimate gas for an Avocado tx. Note: resulting gas usage will usually be
    ///                          with at least ~10k gas buffer compared to actual execution.
    ///                          For Avocado v1.
    ///                          Deploys the Avocado smart wallet if necessary.
    /// @dev  Expected use with `.estimateGas()`.
    ///       Best to combine with a `.callstatic` to determine success / error and other return values of `executeV1()`.
    ///       For indidividual measurements of each `ExecuteBatchParams` execute the respective simulate() single method for it.
    /// @param batches_          Execute batch txs array, same as inputs for `simulateChainAgnosticV1()` just as struct array.
    /// @param continueOnRevert_ flag to signal if one `ExecuteBatchParams` in `batches_` fails, should the rest of them
    ///                          still continue to be executed.
    function simulateBatchV1(ExecuteBatchParams[] calldata batches_, bool continueOnRevert_) external payable returns(SimulateBatchResult[] memory results_){
        uint256 initialGas_ = gasleft();

        uint256 length_ = batches_.length;

        if (length_ < 2) {
            revert AvoForwarder__InvalidParams();
        }

        results_ = new SimulateBatchResult[](length_);
        IAvocadoMultisigV1 avocadoMultisig_;
        uint256 gasSnapshotBefore_;
        for (uint256 i; i < length_; ) {

             (avocadoMultisig_ , , ) = _getSimulateDeployedAvocado(batches_[i].from, batches_[i].index);

             gasSnapshotBefore_ = gasleft();
            if (batches_[i].chainAgnosticHashes.length > 0) {
                (results_[i].success, results_[i].revertReason) = avocadoMultisig_.simulateCastChainAgnostic{
                    value: batches_[i].params.forwardParams.value,
                    // keep back at least enough gas to ensure we can emit events logic below. either calculated reserve gas amount
                    // will be kept back or 1/64th according to EIP150 (whichever is bigger).
                    gas: gasleft() - _dynamicReserveGas(batches_[i].params.params.metadata.length)
                }(batches_[i].params, batches_[i].signaturesParams, batches_[i].chainAgnosticHashes);
            } else {
                (results_[i].success, results_[i].revertReason) = avocadoMultisig_.simulateCast{
                    value: batches_[i].params.forwardParams.value,
                    // keep back at least enough gas to ensure we can emit events logic below. either calculated reserve gas amount
                    // will be kept back or 1/64th according to EIP150 (whichever is bigger).
                    gas: gasleft() - _dynamicReserveGas(batches_[i].params.params.metadata.length)
                }(batches_[i].params.params, batches_[i].params.forwardParams, batches_[i].signaturesParams);
            }
            results_[i].castGasUsed = gasSnapshotBefore_ - gasleft();

            if (results_[i].success) {
                emit Executed(
                    batches_[i].from,
                    batches_[i].index,
                    address(avocadoMultisig_),
                    batches_[i].params.params.source,
                    batches_[i].params.params.metadata
                );
            } else {
                emit ExecuteFailed(
                    batches_[i].from,
                    batches_[i].index,
                    address(avocadoMultisig_),
                    batches_[i].params.params.source,
                    batches_[i].params.params.metadata,
                    results_[i].revertReason
                );
            }

            if (!results_[i].success && !continueOnRevert_) {
                break;
            }

            unchecked {
                ++i;
            }
        }

        _wasteGas(((initialGas_ - gasleft()) * SIMULATE_WASTE_GAS_MARGIN) / 100); // e.g. 10% of used gas
    }

    /// @dev uses up `wasteGasAmount_` of gas
    function _wasteGas(uint256 wasteGasAmount_) internal view {
        uint256 gasLeft_ = gasleft();
        uint256 wasteGasCounter_;
        while (gasLeft_ - gasleft() < wasteGasAmount_) wasteGasCounter_++;
    }
}

abstract contract AvoForwarderOwnerActions is AvoForwarderCore {
    /// @dev modifier checks if `msg.sender` is either owner or allowed auth, reverts if not.
    modifier onlyAuthOrOwner() {
        if (!(msg.sender == owner() || _auths[msg.sender] == 1)) {
            revert AvoForwarder__Unauthorized();
        }

        _;
    }

    /// @notice updates allowed status for broadcasters based on `broadcastersStatus_` and emits `BroadcastersUpdated`.
    /// Executable by allowed auths or owner only.
    function updateBroadcasters(AddressBool[] calldata broadcastersStatus_) external onlyAuthOrOwner {
        uint256 length_ = broadcastersStatus_.length;
        for (uint256 i; i < length_; ) {
            if (broadcastersStatus_[i].addr == address(0)) {
                revert AvoForwarder__InvalidParams();
            }

            _broadcasters[broadcastersStatus_[i].addr] = broadcastersStatus_[i].value ? 1 : 0;

            emit BroadcasterUpdated(broadcastersStatus_[i].addr, broadcastersStatus_[i].value);

            unchecked {
                ++i;
            }
        }
    }

    /// @notice updates allowed status for a auths based on `authsStatus_` and emits `AuthsUpdated`.
    /// Executable by allowed auths or owner only (auths can only remove themselves).
    function updateAuths(AddressBool[] calldata authsStatus_) external onlyAuthOrOwner {
        uint256 length_ = authsStatus_.length;

        bool isMsgSenderOwner = msg.sender == owner();

        for (uint256 i; i < length_; ) {
            if (authsStatus_[i].addr == address(0)) {
                revert AvoForwarder__InvalidParams();
            }

            uint256 setStatus_ = authsStatus_[i].value ? 1 : 0;

            // if `msg.sender` is auth, then operation must be remove and address to be removed must be auth itself
            if (!(isMsgSenderOwner || (setStatus_ == 0 && msg.sender == authsStatus_[i].addr))) {
                revert AvoForwarder__Unauthorized();
            }

            _auths[authsStatus_[i].addr] = setStatus_;

            emit AuthUpdated(authsStatus_[i].addr, authsStatus_[i].value);

            unchecked {
                ++i;
            }
        }
    }
}

contract AvoForwarder is
    AvoForwarderCore,
    AvoForwarderViews,
    AvoForwarderViewsAvocado,
    AvoForwarderV1,
    AvoForwarderChainAgnosticV1,
    AvoForwarderBatchV1,
    AvoForwarderSimulateV1,
    AvoForwarderOwnerActions
{
    /// @notice constructor sets the immutable `avoFactory` (proxy) address and cached bytecodes derived from it
    constructor(IAvoFactory avoFactory_) AvoForwarderCore(avoFactory_) {}

    /// @notice initializes the contract, setting `owner_` and initial `allowedBroadcasters_`
    /// @param owner_                address of owner_ allowed to executed auth limited methods
    /// @param allowedBroadcasters_  initial list of allowed broadcasters to be enabled right away
    function initialize(
        address owner_,
        address[] calldata allowedBroadcasters_
    ) public validAddress(owner_) initializer {
        _transferOwnership(owner_);

        // set initial allowed broadcasters
        uint256 length_ = allowedBroadcasters_.length;
        for (uint256 i; i < length_; ) {
            if (allowedBroadcasters_[i] == address(0)) {
                revert AvoForwarder__InvalidParams();
            }

            _broadcasters[allowedBroadcasters_[i]] = 1;

            emit BroadcasterUpdated(allowedBroadcasters_[i], true);

            unchecked {
                ++i;
            }
        }
    }

    /// @notice override renounce ownership as it could leave the contract in an unwanted state if called by mistake.
    function renounceOwnership() public view override onlyOwner {
        revert AvoForwarder__Unsupported();
    }
}
