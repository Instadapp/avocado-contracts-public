// SPDX-License-Identifier: MIT
pragma solidity >=0.8.18;

import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { Strings } from "@openzeppelin/contracts/utils/Strings.sol";
import { ERC721Holder } from "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import { IERC1271 } from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import { ERC1155Holder } from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";

import { InstaFlashReceiverInterface } from "../external/InstaFlashReceiverInterface.sol";
import { IAvoRegistry } from "../interfaces/IAvoRegistry.sol";
import { IAvoSignersList } from "../interfaces/IAvoSignersList.sol";
import { IAvocadoMultisigV1Base } from "../interfaces/IAvocadoMultisigV1.sol";
import { IAvocadoMultisigV1Secondary } from "../interfaces/IAvocadoMultisigV1Secondary.sol";
import { IAvoConfigV1 } from "../interfaces/IAvoConfigV1.sol";
import { IAvocado } from "../Avocado.sol";
import { AvocadoMultisigErrors } from "./AvocadoMultisigErrors.sol";
import { AvocadoMultisigEvents } from "./AvocadoMultisigEvents.sol";
import { AvocadoMultisigVariables } from "./AvocadoMultisigVariables.sol";
import { AvocadoMultisigInitializable } from "./lib/AvocadoMultisigInitializable.sol";
import { AvocadoMultisigStructs } from "./AvocadoMultisigStructs.sol";
import { AvocadoMultisigProtected } from "./AvocadoMultisig.sol";

/// @dev AvocadoMultisigBase contains all internal helper and base state needed for AvocadoMultisig main AND
///      secondary contract logic.
abstract contract AvocadoMultisigBase is
    AvocadoMultisigErrors,
    AvocadoMultisigEvents,
    AvocadoMultisigVariables,
    AvocadoMultisigStructs,
    AvocadoMultisigInitializable
{
    /***********************************|
    |    CONSTRUCTOR / INITIALIZERS     |
    |__________________________________*/

    constructor(
        IAvoRegistry avoRegistry_,
        address avoForwarder_,
        IAvoSignersList avoSignersList_,
        IAvoConfigV1 avoConfigV1_
    ) AvocadoMultisigVariables(avoRegistry_, avoForwarder_, avoSignersList_, avoConfigV1_) {
        // Ensure logic contract initializer is not abused by disabling initializing
        // see https://forum.openzeppelin.com/t/security-advisory-initialize-uups-implementation-contracts/15301
        // and https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#initializing_the_implementation_contract
        _disableInitializers();
    }

    /***********************************|
    |               INTERNAL            |
    |__________________________________*/

    /// @dev returns the dynamic reserve gas to be kept back for emitting the CastExecuted or CastFailed event
    function _dynamicReserveGas(
        uint256 fixedReserveGas_,
        uint256 signersCount_,
        uint256 metadataLength_
    ) internal pure returns (uint256 reserveGas_) {
        unchecked {
            // the gas usage for the emitting the CastExecuted/CastFailed events depends on the signers count
            // the cost per signer is PER_SIGNER_RESERVE_GAS. We calculate this dynamically to ensure
            // enough reserve gas is reserved in Multisigs with a higher signersCount.
            // same for metadata bytes length, dynamically calculated with cost per byte for emit event
            reserveGas_ =
                fixedReserveGas_ +
                (PER_SIGNER_RESERVE_GAS * signersCount_) +
                (EMIT_EVENT_COST_PER_BYTE * metadataLength_);
        }
    }

    /// @dev Returns the domain separator for the chain with id `DEFAULT_CHAIN_ID` and `salt_`
    function _domainSeparatorV4(bytes32 salt_) internal view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    TYPE_HASH,
                    DOMAIN_SEPARATOR_NAME_HASHED,
                    DOMAIN_SEPARATOR_VERSION_HASHED,
                    DEFAULT_CHAIN_ID,
                    address(this),
                    salt_
                )
            );
    }

    /// @dev returns the EIP712 `CAST_PARAMS_TYPE_HASH` hash for `params_`.
    function _castParamsHash(CastParams memory params_) internal pure returns (bytes32) {
        // get keccak256s for actions
        uint256 actionsLength_ = params_.actions.length;
        bytes memory actionsAbiEncodePacked_;
        for (uint256 i; i < actionsLength_; ) {
            actionsAbiEncodePacked_ = abi.encodePacked(
                actionsAbiEncodePacked_,
                keccak256(
                    abi.encode(
                        ACTION_TYPE_HASH,
                        params_.actions[i].target,
                        keccak256(params_.actions[i].data),
                        params_.actions[i].value,
                        params_.actions[i].operation
                    )
                )
            );

            unchecked {
                ++i;
            }
        }

        return
            keccak256(
                abi.encode(
                    CAST_PARAMS_TYPE_HASH,
                    // actions[]
                    keccak256(actionsAbiEncodePacked_),
                    params_.id,
                    params_.avoNonce,
                    params_.salt,
                    params_.source,
                    keccak256(params_.metadata)
                )
            );
    }

    /// @dev returns the EIP712 `CAST_FORWARD_PARAMS_TYPE_HASH` hash for `forwardParams_`.
    function _castForwardParamsHash(CastForwardParams memory forwardParams_) internal pure returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    CAST_FORWARD_PARAMS_TYPE_HASH,
                    forwardParams_.gas,
                    forwardParams_.gasPrice,
                    forwardParams_.validAfter,
                    forwardParams_.validUntil,
                    forwardParams_.value
                )
            );
    }

    /// @dev returns the EIP712 `CAST_CHAIN_AGNOSTIC_PARAMS_TYPE_HASH` hash for `params_`, `forwardParams_`, `chainId_`.
    function _castChainAgnosticParamsHash(
        CastParams memory params_,
        CastForwardParams memory forwardParams_,
        uint256 chainId_
    ) internal pure returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    CAST_CHAIN_AGNOSTIC_PARAMS_TYPE_HASH,
                    _castParamsHash(params_),
                    _castForwardParamsHash(forwardParams_),
                    chainId_
                )
            );
    }

    /// @dev                        gets the digest (hash) used to verify an EIP712 signature for `chainAgnosticHashes_`.
    /// @param chainAgnosticHashes_ EIP712 type hashes of `CAST_CHAIN_AGNOSTIC_PARAMS_TYPE_HASH` struct for all `CastChainAgnosticParams`
    ///                             struct array elements as used when creating the signature. Result of `getChainAgnosticHashes()`.
    ///                             must be set in the same order as when creating the signature.
    /// @return                     bytes32 digest e.g. for signature or non-sequential nonce
    function _getSigDigestChainAgnostic(
        ChainAgnosticHash[] memory chainAgnosticHashes_
    ) internal view returns (bytes32) {
        uint256 length_ = chainAgnosticHashes_.length;

        bytes memory hashesAbiEncodePacked_;
        bytes memory chainIdsAbiEncodePacked_;
        for (uint256 i; i < length_; ) {
            hashesAbiEncodePacked_ = abi.encodePacked(hashesAbiEncodePacked_, chainAgnosticHashes_[i].hash);
            chainIdsAbiEncodePacked_ = abi.encodePacked(chainIdsAbiEncodePacked_, chainAgnosticHashes_[i].chainId);

            unchecked {
                ++i;
            }
        }

        return
            ECDSA.toTypedDataHash(
                // domain separator without chain id as salt for chain agnofstic actions (chain id is in signed params instead)
                _domainSeparatorV4(
                    DOMAIN_SEPARATOR_CHAIN_AGNOSTIC_SALT_HASHED // includes default chain id (634)
                ),
                // structHash according to CAST_CHAIN_AGNOSTIC_TYPE_HASH
                keccak256(
                    abi.encode(
                        CAST_CHAIN_AGNOSTIC_TYPE_HASH,
                        // hash for castChainAgnostic() params[]
                        keccak256(hashesAbiEncodePacked_),
                        // Note: chain ids must be included in this hash here to guarantee input params for the ChainAgnosticHashes
                        // struct array at e.g. castChainAgnostic() are valid. Otherwise, chainIds for the non-current chain could
                        // be passed in wrongly there.
                        keccak256(chainIdsAbiEncodePacked_)
                    )
                )
            );
    }

    /// @dev                     gets the digest (hash) used to verify an EIP712 signature for `forwardParams_`
    /// @param params_           Cast params such as id, avoNonce and actions to execute
    /// @param forwardParams_    Cast params related to validity of forwarding as instructed and signed
    /// @return                  bytes32 digest e.g. for signature or non-sequential nonce
    function _getSigDigest(
        CastParams memory params_,
        CastForwardParams memory forwardParams_
    ) internal view returns (bytes32) {
        return
            ECDSA.toTypedDataHash(
                // domain separator
                _domainSeparatorV4(
                    DOMAIN_SEPARATOR_SALT_HASHED // includes block.chainid
                ),
                // structHash according to CAST_TYPE_HASH
                keccak256(abi.encode(CAST_TYPE_HASH, _castParamsHash(params_), _castForwardParamsHash(forwardParams_)))
            );
    }

    /// @dev                          Verifies a EIP712 signature, returning valid status in `isValid_` or reverting
    ///                               in case the params for the signatures / digest are wrong
    /// @param digest_                the EIP712 digest for the signature
    /// @param signaturesParams_      SignatureParams structs array for signature and signer:
    ///                               - signature: the EIP712 signature, 65 bytes ECDSA signature for a default EOA.
    ///                                 For smart contract signatures it must fulfill the requirements for the relevant
    ///                                 smart contract `.isValidSignature()` EIP1271 logic
    ///                               - signer: address of the signature signer.
    ///                                 Must match the actual signature signer or refer to the smart contract
    ///                                 that must be an allowed signer and validates signature via EIP1271
    /// @param  isNonSequentialNonce_ flag to signal verify with non sequential nonce or not
    /// @return isValid_              true if the signature is valid, false otherwise
    /// @return recoveredSigners_     recovered valid signer addresses of the signatures. In case that `isValid_` is
    ///                               false, the last element in the array with a value is the invalid signer
    function _verifySig(
        bytes32 digest_,
        SignatureParams[] memory signaturesParams_,
        bool isNonSequentialNonce_
    ) internal view returns (bool isValid_, address[] memory recoveredSigners_) {
        // gas measurements:
        // cost until the for loop in verify signature is:
        // 1 signer 3374 (_getSigners() with only owner is cheaper)
        // 2 signers 6473
        // every additional allowedSigner (!) + 160 gas (additional SSTORE2 load cost)
        // For non-sequential nonce additional cold SLOAD + check cost is ~2200
        // dynamic cost for verifying any additional signer ~6900
        // So formula:
        // Avoado signersCount == 1 ? -> 11_000 gas
        // Avoado signersCount > 1 ? -> 6400  + allowedSignersCount * 160 + signersLength * 6900
        // is non Sequential nonce? + 2200
        // is smart contract signer? + buffer amount. A very basic ECDSA verify call like with e.g. MockSigner costs ~9k.
        uint256 signaturesLength_ = signaturesParams_.length;

        if (
            // enough signatures must be submitted to reach quorom of `requiredSigners`
            signaturesLength_ < _getRequiredSigners() ||
            // for non sequential nonce, if nonce is already used, the signature has already been used and is invalid
            (isNonSequentialNonce_ && nonSequentialNonces[digest_] == 1)
        ) {
            revert AvocadoMultisig__InvalidParams();
        }

        // fill recovered signers array for use in event emit
        recoveredSigners_ = new address[](signaturesLength_);

        // get current signers from storage
        address[] memory allowedSigners_ = _getSigners(); // includes owner
        uint256 allowedSignersLength_ = allowedSigners_.length;
        // track last allowed signer index for loop performance improvements
        uint256 lastAllowedSignerIndex_ = 0;

        bool isContract_ = false; // keeping this variable outside the loop so it is not re-initialized in each loop -> cheaper
        bool isAllowedSigner_ = false;
        for (uint256 i; i < signaturesLength_; ) {
            if (Address.isContract(signaturesParams_[i].signer)) {
                recoveredSigners_[i] = signaturesParams_[i].signer;
                // set flag that the signer is a contract so we don't have to check again in code below
                isContract_ = true;
            } else {
                // recover signer from signature
                recoveredSigners_[i] = ECDSA.recover(digest_, signaturesParams_[i].signature);

                if (signaturesParams_[i].signer != recoveredSigners_[i]) {
                    // signer does not match recovered signer. Either signer param is wrong or params used to
                    // build digest are not the same as for the signature
                    revert AvocadoMultisig__InvalidParams();
                }
            }

            // because signers in storage and signers from signatures input params must be ordered ascending,
            // the for loop can be optimized each new cycle to start from the position where the last signer
            // has been found.
            // this also ensures that input params signers must be ordered ascending off-chain
            // (which again is used to improve performance and simplifies ensuring unique signers)
            for (uint256 j = lastAllowedSignerIndex_; j < allowedSignersLength_; ) {
                if (allowedSigners_[j] == recoveredSigners_[i]) {
                    isAllowedSigner_ = true;
                    unchecked {
                        lastAllowedSignerIndex_ = j + 1; // set to j+1 so that next cycle starts at next array position
                    }
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

            // validate if signer is allowed
            if (!isAllowedSigner_) {
                return (false, recoveredSigners_);
            } else {
                // reset `isAllowedSigner_` for next loop
                isAllowedSigner_ = false;
            }

            if (isContract_) {
                // validate as smart contract signature
                if (
                    IERC1271(signaturesParams_[i].signer).isValidSignature(digest_, signaturesParams_[i].signature) !=
                    EIP1271_MAGIC_VALUE
                ) {
                    // return value is not EIP1271_MAGIC_VALUE -> smart contract returned signature is invalid
                    return (false, recoveredSigners_);
                }

                // reset isContract for next loop (because defined outside of the loop to save gas)
                isContract_ = false;
            }
            // else already everything validated through recovered signer must be an allowed signer etc. in logic above

            unchecked {
                ++i;
            }
        }

        return (true, recoveredSigners_);
    }

    /// @dev                          Verifies a EIP712 signature, reverting if it is not valid.
    /// @param digest_                the EIP712 digest for the signature
    /// @param signaturesParams_      SignatureParams structs array for signature and signer:
    ///                               - signature: the EIP712 signature, 65 bytes ECDSA signature for a default EOA.
    ///                                 For smart contract signatures it must fulfill the requirements for the relevant
    ///                                 smart contract `.isValidSignature()` EIP1271 logic
    ///                               - signer: address of the signature signer.
    ///                                 Must match the actual signature signer or refer to the smart contract
    ///                                 that must be an allowed signer and validates signature via EIP1271
    /// @param  isNonSequentialNonce_ flag to signal verify with non sequential nonce or not
    /// @return recoveredSigners_     recovered valid signer addresses of the signatures. In case that `isValid_` is
    ///                               false, the last element in the array with a value is the invalid signer
    function _verifySigWithRevert(
        bytes32 digest_,
        SignatureParams[] memory signaturesParams_,
        bool isNonSequentialNonce_
    ) internal view returns (address[] memory recoveredSigners_) {
        bool validSignature_;
        (validSignature_, recoveredSigners_) = _verifySig(digest_, signaturesParams_, isNonSequentialNonce_);

        // signature must be valid
        if (!validSignature_) {
            revert AvocadoMultisig__InvalidSignature();
        }
    }
}

/// @dev AvocadoMultisigCore contains all internal helper and base state needed for AvocadoMultisig.sol main logic
abstract contract AvocadoMultisigCore is
    AvocadoMultisigBase,
    ERC721Holder,
    ERC1155Holder,
    InstaFlashReceiverInterface,
    IAvocadoMultisigV1Base,
    IERC1271
{
    IAvocadoMultisigV1Secondary public immutable avoSecondary;

    constructor(IAvocadoMultisigV1Secondary secondary_) {
        if (address(secondary_) == address(0)) {
            revert AvocadoMultisig__InvalidParams();
        }

        avoSecondary = secondary_;
    }

    /// @dev ensures the method can only be called by the same contract itself.
    modifier onlySelf() {
        _requireSelfCalled();
        _;
    }

    /// @dev internal method for modifier logic to reduce bytecode size of contract.
    function _requireSelfCalled() internal view {
        if (msg.sender != address(this)) {
            revert AvocadoMultisig__Unauthorized();
        }
    }

    /// @dev method used to trigger a delegatecall with `data_` to `target_`.
    function _spell(address target_, bytes memory data_) internal returns (bytes memory response_) {
        assembly {
            let succeeded := delegatecall(gas(), target_, add(data_, 0x20), mload(data_), 0, 0)
            let size := returndatasize()

            response_ := mload(0x40)
            mstore(0x40, add(response_, and(add(add(size, 0x20), 0x1f), not(0x1f))))
            mstore(response_, size)
            returndatacopy(add(response_, 0x20), 0, size)

            switch iszero(succeeded)
            case 1 {
                // throw if delegatecall failed
                returndatacopy(0x00, 0x00, size)
                revert(0x00, size)
            }
        }
    }

    /// @dev executes multiple cast actions according to CastParams `params_`, reserving `reserveGas_` in this contract.
    /// Uses a sequential nonce unless `nonSequentialNonce_` is set.
    /// @return success_ boolean flag indicating whether all actions have been executed successfully.
    /// @return revertReason_ if `success_` is false, then revert reason is returned as string here.
    function _executeCast(
        CastParams calldata params_,
        uint256 reserveGas_,
        bytes32 nonSequentialNonce_
    ) internal returns (bool success_, string memory revertReason_) {
        // set allowHash to signal allowed entry into _callTargets with actions in current block only
        _transientAllowHash = bytes31(
            keccak256(abi.encode(params_.actions, params_.id, block.timestamp, _CALL_TARGETS_SELECTOR))
        );

        // nonce must be used *always* if signature is valid
        if (nonSequentialNonce_ == bytes32(0)) {
            // use sequential nonce, already validated in `_validateParams()`
            _avoNonce++;
        } else {
            // use non-sequential nonce, already validated in `_verifySig()`
            nonSequentialNonces[nonSequentialNonce_] = 1;
        }

        // execute _callTargets via a low-level call to create a separate execution frame
        // this is used to revert all the actions if one action fails without reverting the whole transaction
        bytes memory calldata_ = abi.encodeCall(AvocadoMultisigProtected._callTargets, (params_.actions, params_.id));
        bytes memory result_;
        unchecked {
            if (gasleft() < reserveGas_ + 150) {
                // catch out of gas issues when available gas does not even cover reserveGas
                // -> immediately return with out of gas. + 150 to cover sload, sub etc.
                _resetTransientStorage();
                return (false, "AVO__OUT_OF_GAS");
            }
        }
        // using inline assembly for delegatecall to define custom gas amount that should stay here in caller
        assembly {
            success_ := delegatecall(
                // reserve some gas to make sure we can emit CastFailed event even for out of gas cases
                // and execute fee paying logic for `castAuthorized()`.
                // if gasleft() is less than the amount wanted to be sent along, sub would overflow and send all gas
                // that's why there is the explicit check a few lines up.
                sub(gas(), reserveGas_),
                // load _avoImpl from slot 0 and explicitly convert to address with bit mask
                and(sload(0), 0xffffffffffffffffffffffffffffffffffffffff),
                add(calldata_, 0x20),
                mload(calldata_),
                0,
                0
            )
            let size := returndatasize()

            result_ := mload(0x40)
            mstore(0x40, add(result_, and(add(add(size, 0x20), 0x1f), not(0x1f))))
            mstore(result_, size)
            returndatacopy(add(result_, 0x20), 0, size)
        }

        // @dev starting point for measuring reserve gas should be here right after actions execution.
        // on changes in code after execution (below here or below `_executeCast()` call in calling method),
        // measure the needed reserve gas via `gasleft()` anew and update `CAST_AUTHORIZED_RESERVE_GAS`
        // and `CAST_EVENTS_RESERVE_GAS` accordingly. use a method that forces maximum logic execution,
        // e.g. `castAuthorized()` with failing action.
        // gas measurement currently: ~1400 gas for logic in this method below
        if (!success_) {
            if (result_.length == 0) {
                if (gasleft() < reserveGas_ - 150) {
                    // catch out of gas errors where not the action ran out of gas but the logic around execution
                    // of the action itself. -150 to cover gas cost until here
                    revertReason_ = "AVO__OUT_OF_GAS";
                } else {
                    // @dev this case might be caused by edge-case out of gas errors that we were unable to catch,
                    // but could potentially also have other reasons
                    revertReason_ = "AVO__REASON_NOT_DEFINED";
                }
            } else {
                assembly {
                    result_ := add(result_, 0x04)
                }
                revertReason_ = abi.decode(result_, (string));
            }
        }

        // reset all transient variables to get the gas refund (4800)
        _resetTransientStorage();
    }

    /// @dev handles failure of an action execution depending on error cause,
    /// decoding and reverting with `result_` as reason string.
    function _handleActionFailure(uint256 actionMinGasLeft_, uint256 i_, bytes memory result_) internal view {
        if (gasleft() < actionMinGasLeft_) {
            // action ran out of gas. can not add action index as that again might run out of gas. keep revert minimal
            revert("AVO__OUT_OF_GAS");
        }
        revert(string.concat(Strings.toString(i_), avoSecondary.getRevertReasonFromReturnedData(result_)));
    }

    function _simulateCast(
        CastParams calldata params_,
        CastForwardParams calldata forwardParams_,
        SignatureParams[] memory signaturesParams_,
        ChainAgnosticHash[] memory chainAgnosticHashes_,
        bool estimate_
    ) internal returns (bool success_, string memory revertReason_) {
        if (
            !(msg.sender == 0x000000000000000000000000000000000000dEaD ||
                (msg.sender == avoForwarder && tx.origin == 0x000000000000000000000000000000000000dEaD))
        ) {
            // sender must be the allowed AvoForwarder and tx origin must be dead address,
            // or msg.sender must be 0x000000000000000000000000000000000000dEaD directly.
            revert AvocadoMultisig__Unauthorized();
        }

        (success_, revertReason_) = abi.decode(
            _spell(
                address(avoSecondary),
                abi.encodeCall(
                    avoSecondary.simulateCast,
                    (params_, forwardParams_, signaturesParams_, chainAgnosticHashes_)
                )
            ),
            (bool, string)
        );

        if (estimate_ && !success_) {
            // on estimate, revert to get a more accurate gas estimation result.
            revert(revertReason_);
        }
    }

    /// @dev                        executes a cast process for `cast()` or `castChainAgnostic()`
    /// @param params_              Cast params such as id, avoNonce and actions to execute
    /// @param forwardParams_       Cast params related to validity of forwarding as instructed and signed
    /// @param signaturesParams_    SignatureParams structs array for signature and signer:
    ///                              - signature: the EIP712 signature, 65 bytes ECDSA signature for a default EOA.
    ///                                For smart contract signatures it must fulfill the requirements for the relevant
    ///                                smart contract `.isValidSignature()` EIP1271 logic
    ///                              - signer: address of the signature signer.
    ///                                Must match the actual signature signer or refer to the smart contract
    ///                                that must be an allowed signer and validates signature via EIP1271
    /// @param chainAgnosticHashes_ EIP712 type hashes of `CAST_CHAIN_AGNOSTIC_PARAMS_TYPE_HASH` struct for all `CastChainAgnosticParams`
    ///                             struct array elements as used when creating the signature. Result of `getChainAgnosticHashes()`.
    ///                             must be set in the same order as when creating the signature.
    /// @return success_            true if all actions were executed succesfully, false otherwise.
    /// @return revertReason_       revert reason if one of the actions fails in the following format:
    ///                             The revert reason will be prefixed with the index of the action.
    ///                             e.g. if action 1 fails, then the reason will be "1_reason".
    ///                             if an action in the flashloan callback fails (or an otherwise nested action),
    ///                             it will be prefixed with with two numbers: "1_2_reason".
    ///                             e.g. if action 1 is the flashloan, and action 2 of flashloan actions fails,
    ///                             the reason will be 1_2_reason.
    function _cast(
        CastParams calldata params_,
        CastForwardParams calldata forwardParams_,
        SignatureParams[] memory signaturesParams_,
        ChainAgnosticHash[] memory chainAgnosticHashes_
    ) internal returns (bool success_, string memory revertReason_) {
        if (msg.sender != avoForwarder) {
            // sender must be the allowed AvoForwarder
            revert AvocadoMultisig__Unauthorized();
        }

        unchecked {
            // compare actual sent gas to user instructed gas, adding 500 to `gasleft()` for approx. already used gas
            if ((gasleft() + 500) < forwardParams_.gas) {
                // relayer has not sent enough gas to cover gas limit as user instructed.
                // this error should not be blamed on the user but rather on the relayer
                revert AvocadoMultisig__InsufficientGasSent();
            }
        }

        // @dev gas measurement: uses maximum 685 gas when all params must be validated
        _validateParams(
            params_.actions.length,
            params_.avoNonce,
            forwardParams_.validAfter,
            forwardParams_.validUntil,
            forwardParams_.value
        );

        bytes32 digest_;
        if (chainAgnosticHashes_.length > 0) {
            // validate that input `CastParams` and `CastForwardParams` are present in `chainAgnosticHashes_`
            _validateChainAgnostic(
                _castChainAgnosticParamsHash(params_, forwardParams_, block.chainid),
                chainAgnosticHashes_
            );

            digest_ = _getSigDigestChainAgnostic(chainAgnosticHashes_);
        } else {
            digest_ = _getSigDigest(params_, forwardParams_);
        }

        address[] memory signers_ = _verifySigWithRevert(digest_, signaturesParams_, params_.avoNonce == -1);

        (success_, revertReason_) = _executeCast(
            params_,
            _dynamicReserveGas(CAST_EVENTS_RESERVE_GAS, signers_.length, params_.metadata.length),
            params_.avoNonce == -1 ? digest_ : bytes32(0)
        );

        // @dev on changes in the code below this point, measure the needed reserve gas via `gasleft()` anew
        // and update the reserve gas constant amounts.
        // gas measurement currently: ~7500 gas for emit event with max revertReason length
        if (success_) {
            emit CastExecuted(params_.source, msg.sender, signers_, params_.metadata);
        } else {
            emit CastFailed(params_.source, msg.sender, signers_, revertReason_, params_.metadata);
        }
        // @dev ending point for measuring reserve gas should be here. Also see comment in `AvocadoMultisigCore._executeCast()`
    }

    /// @dev executes `actions_` with respective target, calldata, operation etc.
    /// IMPORTANT: Validation of `id_` and `_transientAllowHash` is expected to happen in `executeOperation()` and `_callTargets()`.
    /// catches out of gas errors (as well as possible), reverting with `AVO__OUT_OF_GAS`.
    /// reverts with action index + error code in case of failure (e.g. "1_SOME_ERROR").
    function _executeActions(Action[] memory actions_, uint256 id_, bool isFlashloanCallback_) internal {
        // reset _transientAllowHash immediately to avert reentrancy etc. & get the gas refund (4800)
        _resetTransientStorage();

        uint256 storageSlot0Snapshot_; // avoImpl, nonce, initialized vars
        uint256 storageSlot1Snapshot_; // signers related variables
        // delegate call = ids 1 and 21
        bool isDelegateCallId_ = id_ == 1 || id_ == 21;
        if (isDelegateCallId_) {
            // store values before execution to make sure core storage vars are not modified by a delegatecall.
            // this ensures the smart wallet does not end up in a corrupted state.
            // for mappings etc. it is hard to protect against storage changes, so we must rely on the owner / signer
            // to know what is being triggered and the effects of a tx
            assembly {
                storageSlot0Snapshot_ := sload(0x0) // avoImpl, nonce & initialized vars
                storageSlot1Snapshot_ := sload(0x1) // signers related variables
            }
        }

        uint256 actionsLength_ = actions_.length;
        for (uint256 i; i < actionsLength_; ) {
            Action memory action_ = actions_[i];

            // execute action
            bool success_;
            bytes memory result_;
            uint256 actionMinGasLeft_;
            if (action_.operation == 0 && (id_ < 2 || id_ == 20 || id_ == 21)) {
                // call (operation = 0 & id = call(0 / 20) or mixed(1 / 21))
                unchecked {
                    // store amount of gas that stays with caller, according to EIP150 to detect out of gas errors
                    // -> as close as possible to actual call
                    actionMinGasLeft_ = gasleft() / 64;
                }

                // low-level call will return success true also if action target is not even a contract.
                // we do not explicitly check for this, default interaction is via UI which can check and handle this.
                // Also applies to delegatecall etc.
                (success_, result_) = action_.target.call{ value: action_.value }(action_.data);

                // handle action failure right after external call to better detect out of gas errors
                if (!success_) {
                    _handleActionFailure(actionMinGasLeft_, i, result_);
                }
            } else if (action_.operation == 1 && isDelegateCallId_) {
                // delegatecall (operation = 1 & id = mixed(1 / 21))
                unchecked {
                    // store amount of gas that stays with caller, according to EIP150 to detect out of gas errors
                    // -> as close as possible to actual call
                    actionMinGasLeft_ = gasleft() / 64;
                }

                (success_, result_) = action_.target.delegatecall(action_.data);

                // handle action failure right after external call to better detect out of gas errors
                if (!success_) {
                    _handleActionFailure(actionMinGasLeft_, i, result_);
                }

                // reset _transientAllowHash to make sure it can not be set up in any way for reentrancy
                _resetTransientStorage();

                // for delegatecall, make sure storage was not modified. After every action, to also defend reentrancy
                uint256 storageSlot0_;
                uint256 storageSlot1_;
                assembly {
                    storageSlot0_ := sload(0x0) // avoImpl, nonce & initialized vars
                    storageSlot1_ := sload(0x1) // signers related variables
                }

                if (!(storageSlot0_ == storageSlot0Snapshot_ && storageSlot1_ == storageSlot1Snapshot_)) {
                    revert(string.concat(Strings.toString(i), "_AVO__MODIFIED_STORAGE"));
                }
            } else if (action_.operation == 2 && (id_ == 20 || id_ == 21)) {
                // flashloan (operation = 2 & id = flashloan(20 / 21))
                if (isFlashloanCallback_) {
                    revert(string.concat(Strings.toString(i), "_AVO__NO_FLASHLOAN_IN_FLASHLOAN"));
                }
                // flashloan is always executed via .call, flashloan aggregator uses `msg.sender`, so .delegatecall
                // wouldn't send funds to this contract but rather to the original sender.

                bytes memory data_ = action_.data;
                assembly {
                    data_ := add(data_, 4) // Skip function selector (4 bytes)
                }
                // get actions data from calldata action_.data. Only supports InstaFlashAggregatorInterface
                (, , , data_, ) = abi.decode(data_, (address[], uint256[], uint256, bytes, bytes));

                // set allowHash to signal allowed entry into executeOperation()
                _transientAllowHash = bytes31(
                    keccak256(abi.encode(data_, block.timestamp, EXECUTE_OPERATION_SELECTOR))
                );
                // store id_ in transient storage slot
                _transientId = uint8(id_);

                unchecked {
                    // store amount of gas that stays with caller, according to EIP150 to detect out of gas errors
                    // -> as close as possible to actual call
                    actionMinGasLeft_ = gasleft() / 64;
                }

                // handle action failure right after external call to better detect out of gas errors
                (success_, result_) = action_.target.call{ value: action_.value }(action_.data);

                if (!success_) {
                    _handleActionFailure(actionMinGasLeft_, i, result_);
                }

                // reset _transientAllowHash to prevent reentrancy during actions execution
                _resetTransientStorage();
            } else {
                // either operation does not exist or the id was not set according to what the action wants to execute
                revert(string.concat(Strings.toString(i), "_AVO__INVALID_ID_OR_OPERATION"));
            }

            unchecked {
                ++i;
            }
        }
    }

    /// @dev                   Validates input params, reverts on invalid values.
    /// @param actionsLength_  the length of the actions array to execute
    /// @param avoNonce_       the avoNonce from input CastParams
    /// @param validAfter_     timestamp after which the request is valid
    /// @param validUntil_     timestamp before which the request is valid
    /// @param value_          the msg.value expected to be sent along
    function _validateParams(
        uint256 actionsLength_,
        int256 avoNonce_,
        uint256 validAfter_,
        uint256 validUntil_,
        uint256 value_
    ) internal view {
        // make sure actions are defined and nonce is valid:
        // must be -1 to use a non-sequential nonce or otherwise it must match the avoNonce
        if (!(actionsLength_ > 0 && (avoNonce_ == -1 || uint256(avoNonce_) == _avoNonce))) {
            revert AvocadoMultisig__InvalidParams();
        }

        // make sure request is within valid timeframe
        if ((validAfter_ > block.timestamp) || (validUntil_ > 0 && validUntil_ < block.timestamp)) {
            revert AvocadoMultisig__InvalidTiming();
        }

        // make sure msg.value matches `value_` (if set)
        if (value_ > 0 && msg.value != value_) {
            revert AvocadoMultisig__InvalidParams();
        }
    }

    /// @dev Validates input params for `castChainAgnostic`: verifies that the `curCastChainAgnosticHash_` is present in
    ///      the `castChainAgnosticHashes_` array of hashes. Reverts with `AvocadoMultisig__InvalidParams` if not.
    ///      Reverts with `AvocadoMultisig__ChainAgnosticChainMismatch` if the hash is present but valid for another chain.
    function _validateChainAgnostic(
        bytes32 curCastChainAgnosticHash_,
        ChainAgnosticHash[] memory castChainAgnosticHashes_
    ) internal view {
        uint256 length_ = castChainAgnosticHashes_.length;
        // chain agnostic must be at least 2 hashes
        if (length_ > 1) {
            for (uint256 i; i < length_; ) {
                if (
                    curCastChainAgnosticHash_ == castChainAgnosticHashes_[i].hash &&
                    block.chainid == castChainAgnosticHashes_[i].chainId
                ) {
                    // hash must be found, and must be for the current chain to be valid
                    return;
                }

                unchecked {
                    ++i;
                }
            }
        }

        // `_castChainAgnosticParamsHash()` of current input params is not present in castChainAgnosticHashes_ -> revert
        revert AvocadoMultisig__InvalidParams();
    }

    /// @dev                      gets the digest (hash) used to verify an EIP712 signature for `authorizedParams_`
    /// @param params_            Cast params such as id, avoNonce and actions to execute
    /// @param authorizedParams_  Cast params related to execution through owner such as maxFee
    /// @return                   bytes32 digest e.g. for signature or non-sequential nonce
    function _getSigDigestAuthorized(
        CastParams memory params_,
        CastAuthorizedParams memory authorizedParams_
    ) internal view returns (bytes32) {
        return
            ECDSA.toTypedDataHash(
                // domain separator
                _domainSeparatorV4(
                    DOMAIN_SEPARATOR_SALT_HASHED // includes block.chainid
                ),
                // structHash according to CAST_AUTHORIZED_TYPE_HASH
                keccak256(
                    abi.encode(
                        CAST_AUTHORIZED_TYPE_HASH,
                        _castParamsHash(params_),
                        // CastAuthorizedParams hash
                        keccak256(
                            abi.encode(
                                CAST_AUTHORIZED_PARAMS_TYPE_HASH,
                                authorizedParams_.maxFee,
                                authorizedParams_.gasPrice,
                                authorizedParams_.validAfter,
                                authorizedParams_.validUntil
                            )
                        )
                    )
                )
            );
    }
}
