// SPDX-License-Identifier: MIT
pragma solidity >=0.8.18;

import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { IERC1271 } from "@openzeppelin/contracts/interfaces/IERC1271.sol";

import { IAvoRegistry } from "../interfaces/IAvoRegistry.sol";
import { IAvoSignersList } from "../interfaces/IAvoSignersList.sol";
import { IAvocadoMultisigV1Base } from "../interfaces/IAvocadoMultisigV1.sol";
import { IAvocadoMultisigV1Secondary, IAvocadoMultisigV1SecondaryConstants } from "../interfaces/IAvocadoMultisigV1Secondary.sol";
import { IAvocado } from "../Avocado.sol";
import { IAvoConfigV1 } from "../interfaces/IAvoConfigV1.sol";
import { AvocadoMultisigBase, AvocadoMultisigCore } from "./AvocadoMultisigCore.sol";

// --------------------------- DEVELOPER NOTES -----------------------------------------
// @dev IMPORTANT: all storage variables go into AvocadoMultisigVariables.sol
// -------------------------------------------------------------------------------------

// empty interface used for Natspec docs for nice layout in automatically generated docs:
//
/// @title  AvocadoMultisig v1.1.0
/// @notice Smart wallet enabling meta transactions through multiple EIP712 signatures (Multisig n out of m).
///
/// Supports:
/// - Executing arbitrary actions
/// - Receiving NFTs (ERC721)
/// - Receiving ERC1155 tokens
/// - ERC1271 smart contract signatures
/// - Instadapp Flashloan callbacks
/// - chain-agnostic signatures, user can sign once for execution of actions on different chains.
///
/// The `cast` method allows the AvoForwarder (relayer) to execute multiple arbitrary actions authorized by signature.
///
/// Broadcasters are expected to call the AvoForwarder contract `execute()` method, which also automatically
/// deploys an AvocadoMultisig if necessary first.
///
/// Upgradeable by calling `upgradeTo` through a `cast` / `castAuthorized` call.
///
/// The `castAuthorized` method allows the signers of the wallet to execute multiple arbitrary actions with signatures
/// without the AvoForwarder in between, to guarantee the smart wallet is truly non-custodial.
///
/// _@dev Notes:_
/// - This contract implements parts of EIP-2770 in a minimized form. E.g. domainSeparator is immutable etc.
/// - This contract does not implement ERC2771, because trusting an upgradeable "forwarder" bears a security
/// risk for this non-custodial wallet.
/// - Signature related logic is based off of OpenZeppelin EIP712Upgradeable.
/// - All signatures are validated for defaultChainId of `634` instead of `block.chainid` from opcode (EIP-1344).
/// - For replay protection, the current `block.chainid` instead is used in the EIP-712 salt.
interface AvocadoMultisig_V1 {}

/// @dev Simple contract to upgrade the implementation address stored at storage slot 0x0.
///      Mostly based on OpenZeppelin ERC1967Upgrade contract, adapted with onlySelf etc.
///      IMPORTANT: For any new implementation, the upgrade method MUST be in the implementation itself,
///      otherwise it can not be upgraded anymore!
abstract contract AvocadoMultisigSelfUpgradeable is AvocadoMultisigCore {
    /// @notice upgrade the contract to a new implementation address.
    ///         - Must be a valid version at the AvoRegistry.
    ///         - Can only be self-called (authorization same as for `cast` methods).
    /// @param avoImplementation_       New contract address
    /// @param afterUpgradeHookData_    flexible bytes for custom usage in after upgrade hook logic
    //
    // Implementation must call `_afterUpgradeHook()`
    function upgradeTo(address avoImplementation_, bytes calldata afterUpgradeHookData_) public onlySelf {
        _spell(address(avoSecondary), msg.data);
    }

    /// @notice hook called after executing an upgrade from previous `fromImplementation_`, with flexible bytes `data_`
    function _afterUpgradeHook(address fromImplementation_, bytes calldata data_) public virtual onlySelf {}
}

abstract contract AvocadoMultisigProtected is AvocadoMultisigCore {
    /***********************************|
    |             ONLY SELF             |
    |__________________________________*/

    /// @notice occupies the sequential `avoNonces_` in storage. This can be used to cancel / invalidate
    ///         a previously signed request(s) because the nonce will be "used" up.
    ///         - Can only be self-called (authorization same as for `cast` methods).
    /// @param  avoNonces_ sequential ascending ordered nonces to be occupied in storage.
    ///         E.g. if current AvoNonce is 77 and txs are queued with avoNonces 77, 78 and 79,
    ///         then you would submit [78, 79] here because 77 will be occupied by the tx executing
    ///         `occupyAvoNonces()` as an action itself. If executing via non-sequential nonces, you would
    ///         submit [77, 78, 79].
    ///         - Maximum array length is 5.
    ///         - gap from the current avoNonce will revert (e.g. [79, 80] if current one is 77)
    function occupyAvoNonces(uint88[] calldata avoNonces_) external onlySelf {
        _spell(address(avoSecondary), msg.data);
    }

    /// @notice occupies the `nonSequentialNonces_` in storage. This can be used to cancel / invalidate
    ///         previously signed request(s) because the nonce will be "used" up.
    ///         - Can only be self-called (authorization same as for `cast` methods).
    /// @param  nonSequentialNonces_ the non-sequential nonces to occupy
    function occupyNonSequentialNonces(bytes32[] calldata nonSequentialNonces_) external onlySelf {
        _spell(address(avoSecondary), msg.data);
    }

    /***********************************|
    |         FLASHLOAN CALLBACK        |
    |__________________________________*/

    /// @dev                    callback used by Instadapp Flashloan Aggregator, executes operations while owning
    ///                         the flashloaned amounts. `data_` must contain actions, one of them must pay back flashloan
    // /// @param assets_       assets_ received a flashloan for
    // /// @param amounts_      flashloaned amounts for each asset
    // /// @param premiums_     fees to pay for the flashloan
    /// @param initiator_       flashloan initiator -> must be this contract
    /// @param data_            data bytes containing the `abi.encoded()` actions that are executed like in `CastParams.actions`
    function executeOperation(
        address[] calldata /*  assets_ */,
        uint256[] calldata /*  amounts_ */,
        uint256[] calldata /*  premiums_ */,
        address initiator_,
        bytes calldata data_
    ) external returns (bool) {
        // @dev using the valid case inverted via one ! to optimize gas usage
        // data_ includes id and actions
        if (
            !(_transientAllowHash ==
                bytes31(keccak256(abi.encode(data_, block.timestamp, EXECUTE_OPERATION_SELECTOR))) &&
                initiator_ == address(this))
        ) {
            revert AvocadoMultisig__Unauthorized();
        }

        // get and reset transient id
        uint256 id_ = uint256(_transientId);
        _transientId = 0;

        if (tx.origin == 0x000000000000000000000000000000000000dEaD) {
            // tx origin 0x000000000000000000000000000000000000dEaD used for backend gas estimations -> forward to simulate
            _spell(
                address(avoSecondary),
                abi.encodeCall(avoSecondary._simulateExecuteActions, (abi.decode(data_, (Action[])), id_, true))
            );
        } else {
            // decode actions to be executed after getting the flashloan and id_ packed into the data_
            _executeActions(abi.decode(data_, (Action[])), id_, true);
        }

        return true;
    }

    /***********************************|
    |         INDIRECT INTERNAL         |
    |__________________________________*/

    /// @dev             executes a low-level .call or .delegateCall on all `actions_`.
    ///                  Can only be self-called by this contract under certain conditions, essentially internal method.
    ///                  This is called like an external call to create a separate execution frame.
    ///                  This way we can revert all the `actions_` if one fails without reverting the whole transaction.
    /// @param actions_  the actions to execute (target, data, value, operation)
    /// @param id_       id for `actions_`, see `CastParams.id`
    function _callTargets(Action[] calldata actions_, uint256 id_) external payable {
        if (tx.origin == 0x000000000000000000000000000000000000dEaD) {
            // tx origin 0x000000000000000000000000000000000000dEaD used for backend gas estimations -> forward to simulate
            _spell(address(avoSecondary), abi.encodeCall(avoSecondary._simulateExecuteActions, (actions_, id_, false)));
        } else {
            // _transientAllowHash must be set
            if (
                (_transientAllowHash !=
                    bytes31(keccak256(abi.encode(actions_, id_, block.timestamp, _CALL_TARGETS_SELECTOR))))
            ) {
                revert AvocadoMultisig__Unauthorized();
            }

            _executeActions(actions_, id_, false);
        }
    }
}

abstract contract AvocadoMultisigEIP1271 is AvocadoMultisigCore {
    /// @inheritdoc IERC1271
    /// @param signature This can be one of the following:
    ///         - empty: `hash` must be a previously signed message in storage then.
    ///         - 65 bytes: owner signature for a Multisig with only owner as signer (requiredSigners = 1, signers=[owner]).
    ///         - a multiple of 85 bytes, through grouping of 65 bytes signature + 20 bytes signer address each.
    ///           To signal decoding this way, the signature bytes must be prefixed with `0xDEC0DE6520`.
    ///         - the `abi.encode` result for `SignatureParams` struct array.
    /// @dev reverts with `AvocadoMultisig__InvalidEIP1271Signature` or `AvocadoMultisig__InvalidParams` if signature is invalid.
    /// @dev input `message_` is hashed with `domainSeparatorV4()` according to EIP712 typed data (`EIP1271_TYPE_HASH`)
    function isValidSignature(
        bytes32 hash,
        bytes calldata signature
    ) external view override returns (bytes4 magicValue) {
        // hashing with domain separator mitigates any potential replaying on other networks or other Avocados of the same owner
        hash = ECDSA.toTypedDataHash(
            _domainSeparatorV4(
                DOMAIN_SEPARATOR_SALT_HASHED // includes block.chainid
            ),
            keccak256(abi.encode(EIP1271_TYPE_HASH, hash))
        );

        // @dev function params without _ for inheritdoc
        if (signature.length == 0) {
            // must be pre-allow-listed via `signMessage` method
            if (_signedMessages[hash] != 1) {
                revert AvocadoMultisig__InvalidEIP1271Signature();
            }
        } else {
            (bool validSignature_, ) = _verifySig(
                hash,
                // decode signaturesParams_ from bytes signature
                avoSecondary.decodeEIP1271Signature(signature, IAvocado(address(this))._owner()),
                // we have no way to know nonce type, so make sure validity test covers everything.
                // setting this flag true will check that the digest is not a used non-sequential nonce.
                // unfortunately, for sequential nonces it adds unneeded verification and gas cost,
                // because the check will always pass, but there is no way around it.
                true
            );
            if (!validSignature_) {
                revert AvocadoMultisig__InvalidEIP1271Signature();
            }
        }

        return EIP1271_MAGIC_VALUE;
    }

    /// @notice Marks a bytes32 `message_` (signature digest) as signed, making it verifiable by EIP-1271 `isValidSignature()`.
    ///         - Can only be self-called (authorization same as for `cast` methods).
    /// @param message_ data hash to be allow-listed as signed
    /// @dev input `message_` is hashed with `domainSeparatorV4()` according to EIP712 typed data (`EIP1271_TYPE_HASH`)
    function signMessage(bytes32 message_) external onlySelf {
        _spell(address(avoSecondary), msg.data);
    }

    /// @notice Removes a previously `signMessage()` signed bytes32 `message_` (signature digest).
    ///         - Can only be self-called (authorization same as for `cast` methods).
    /// @param message_ data hash to be removed from allow-listed signatures
    function removeSignedMessage(bytes32 message_) external onlySelf {
        _spell(address(avoSecondary), msg.data);
    }
}

abstract contract AvocadoMultisigSigners is AvocadoMultisigCore {
    /// @notice adds `addSigners_` to allowed signers and sets required signers count to `requiredSigners_`
    /// Note the `addSigners_` to be added must:
    ///     - NOT be duplicates (already present in current allowed signers)
    ///     - NOT be the zero address
    ///     - be sorted ascending
    function addSigners(address[] calldata addSigners_, uint8 requiredSigners_) external onlySelf {
        _spell(address(avoSecondary), msg.data);
    }

    /// @notice removes `removeSigners_` from allowed signers and sets required signers count to `requiredSigners_`
    /// Note the `removeSigners_` to be removed must:
    ///     - NOT be the owner
    ///     - be sorted ascending
    ///     - be present in current allowed signers
    function removeSigners(address[] calldata removeSigners_, uint8 requiredSigners_) external onlySelf {
        _spell(address(avoSecondary), msg.data);
    }

    /// @notice sets number of required signers for a valid request to `requiredSigners_`
    function setRequiredSigners(uint8 requiredSigners_) external onlySelf {
        _spell(address(avoSecondary), msg.data);
    }
}

abstract contract AvocadoMultisigCast is AvocadoMultisigCore {
    /// @inheritdoc IAvocadoMultisigV1Base
    function getSigDigest(
        CastParams memory params_,
        CastForwardParams memory forwardParams_
    ) public view returns (bytes32) {
        return _getSigDigest(params_, forwardParams_);
    }

    /// @inheritdoc IAvocadoMultisigV1Base
    function verify(
        CastParams calldata params_,
        CastForwardParams calldata forwardParams_,
        SignatureParams[] calldata signaturesParams_
    ) external view returns (bool) {
        _validateParams(
            params_.actions.length,
            params_.avoNonce,
            forwardParams_.validAfter,
            forwardParams_.validUntil,
            forwardParams_.value
        );

        _verifySigWithRevert(_getSigDigest(params_, forwardParams_), signaturesParams_, params_.avoNonce == -1);

        return true;
    }

    /// @inheritdoc IAvocadoMultisigV1Base
    function cast(
        CastParams calldata params_,
        CastForwardParams calldata forwardParams_,
        SignatureParams[] memory signaturesParams_
    ) external payable returns (bool success_, string memory revertReason_) {
        return _cast(params_, forwardParams_, signaturesParams_, new ChainAgnosticHash[](0));
    }

    /// @inheritdoc IAvocadoMultisigV1Base
    function simulateCast(
        CastParams calldata params_,
        CastForwardParams calldata forwardParams_,
        SignatureParams[] memory signaturesParams_
    ) external payable returns (bool success_, string memory revertReason_) {
        return _simulateCast(params_, forwardParams_, signaturesParams_, new ChainAgnosticHash[](0), false);
    }

    /// @inheritdoc IAvocadoMultisigV1Base
    function estimateCast(
        CastParams calldata params_,
        CastForwardParams calldata forwardParams_,
        SignatureParams[] memory signaturesParams_
    ) external payable returns (bool success_, string memory revertReason_) {
        return _simulateCast(params_, forwardParams_, signaturesParams_, new ChainAgnosticHash[](0), true);
    }
}

abstract contract AvocadoMultisigCastChainAgnostic is AvocadoMultisigCore {
    /// @inheritdoc IAvocadoMultisigV1Base
    function castChainAgnostic(
        CastChainAgnosticParams calldata params_,
        SignatureParams[] memory signaturesParams_,
        ChainAgnosticHash[] calldata chainAgnosticHashes_
    ) external payable returns (bool success_, string memory revertReason_) {
        if (params_.chainId != block.chainid) {
            revert AvocadoMultisig__InvalidParams();
        }

        return _cast(params_.params, params_.forwardParams, signaturesParams_, chainAgnosticHashes_);
    }

    /// @inheritdoc IAvocadoMultisigV1Base
    function getChainAgnosticHashes(
        CastChainAgnosticParams[] calldata params_
    ) public pure returns (ChainAgnosticHash[] memory chainAgnosticHashes_) {
        uint256 length_ = params_.length;
        if (length_ < 2) {
            revert AvocadoMultisig__InvalidParams();
        }
        chainAgnosticHashes_ = new ChainAgnosticHash[](length_);
        for (uint256 i; i < length_; ) {
            chainAgnosticHashes_[i] = ChainAgnosticHash(
                _castChainAgnosticParamsHash(params_[i].params, params_[i].forwardParams, params_[i].chainId),
                params_[i].chainId
            );

            unchecked {
                ++i;
            }
        }
    }

    /// @inheritdoc IAvocadoMultisigV1Base
    function getSigDigestChainAgnostic(CastChainAgnosticParams[] calldata params_) public view returns (bytes32) {
        return _getSigDigestChainAgnostic(getChainAgnosticHashes(params_));
    }

    /// @inheritdoc IAvocadoMultisigV1Base
    function getSigDigestChainAgnosticFromHashes(
        ChainAgnosticHash[] calldata chainAgnosticHashes_
    ) public view returns (bytes32) {
        return _getSigDigestChainAgnostic(chainAgnosticHashes_);
    }

    /// @inheritdoc IAvocadoMultisigV1Base
    function verifyChainAgnostic(
        CastChainAgnosticParams calldata params_,
        SignatureParams[] calldata signaturesParams_,
        ChainAgnosticHash[] calldata chainAgnosticHashes_
    ) public view returns (bool) {
        if (params_.chainId != block.chainid) {
            revert AvocadoMultisig__InvalidParams();
        }

        _validateParams(
            params_.params.actions.length,
            params_.params.avoNonce,
            params_.forwardParams.validAfter,
            params_.forwardParams.validUntil,
            params_.forwardParams.value
        );

        _validateChainAgnostic(
            _castChainAgnosticParamsHash(params_.params, params_.forwardParams, block.chainid),
            chainAgnosticHashes_
        );

        _verifySigWithRevert(
            _getSigDigestChainAgnostic(chainAgnosticHashes_),
            signaturesParams_,
            params_.params.avoNonce == -1
        );

        return true;
    }

    /// @inheritdoc IAvocadoMultisigV1Base
    function simulateCastChainAgnostic(
        CastChainAgnosticParams calldata params_,
        SignatureParams[] memory signaturesParams_,
        ChainAgnosticHash[] calldata chainAgnosticHashes_
    ) external payable returns (bool success_, string memory revertReason_) {
        if (params_.chainId != block.chainid) {
            revert AvocadoMultisig__InvalidParams();
        }

        return _simulateCast(params_.params, params_.forwardParams, signaturesParams_, chainAgnosticHashes_, false);
    }

    /// @inheritdoc IAvocadoMultisigV1Base
    function estimateCastChainAgnostic(
        CastChainAgnosticParams calldata params_,
        SignatureParams[] memory signaturesParams_,
        ChainAgnosticHash[] calldata chainAgnosticHashes_
    ) external payable returns (bool success_, string memory revertReason_) {
        if (params_.chainId != block.chainid) {
            revert AvocadoMultisig__InvalidParams();
        }

        return _simulateCast(params_.params, params_.forwardParams, signaturesParams_, chainAgnosticHashes_, true);
    }
}

abstract contract AvocadoMultisigCastAuthorized is AvocadoMultisigCore {
    /// @inheritdoc IAvocadoMultisigV1Base
    function getSigDigestAuthorized(
        CastParams memory params_,
        CastAuthorizedParams memory authorizedParams_
    ) public view returns (bytes32) {
        return _getSigDigestAuthorized(params_, authorizedParams_);
    }

    /// @inheritdoc IAvocadoMultisigV1Base
    function verifyAuthorized(
        CastParams calldata params_,
        CastAuthorizedParams calldata authorizedParams_,
        SignatureParams[] calldata signaturesParams_
    ) external view returns (bool) {
        // make sure actions are defined and nonce is valid
        _validateParams(
            params_.actions.length,
            params_.avoNonce,
            authorizedParams_.validAfter,
            authorizedParams_.validUntil,
            0 // no value param in authorized interaction
        );

        _verifySigWithRevert(
            _getSigDigestAuthorized(params_, authorizedParams_),
            signaturesParams_,
            params_.avoNonce == -1
        );

        return true;
    }

    /// @inheritdoc IAvocadoMultisigV1Base
    function castAuthorized(
        CastParams calldata params_,
        CastAuthorizedParams calldata authorizedParams_,
        SignatureParams[] memory signaturesParams_
    ) external payable returns (bool success_, string memory revertReason_) {
        uint256 gasSnapshot_ = gasleft();

        // make sure actions are defined and nonce is valid
        _validateParams(
            params_.actions.length,
            params_.avoNonce,
            authorizedParams_.validAfter,
            authorizedParams_.validUntil,
            0 // no value param in authorized interaction
        );

        bytes32 digest_ = _getSigDigestAuthorized(params_, authorizedParams_);
        address[] memory signers_ = _verifySigWithRevert(digest_, signaturesParams_, params_.avoNonce == -1);

        (success_, revertReason_) = _executeCast(
            params_,
            _dynamicReserveGas(CAST_AUTHORIZED_RESERVE_GAS, signers_.length, params_.metadata.length),
            params_.avoNonce == -1 ? digest_ : bytes32(0)
        );

        // @dev on changes in the code below this point, measure the needed reserve gas via `gasleft()` anew
        // and update reserve gas constant amounts
        if (success_) {
            emit CastExecuted(params_.source, msg.sender, signers_, params_.metadata);
        } else {
            emit CastFailed(params_.source, msg.sender, signers_, revertReason_, params_.metadata);
        }

        // @dev `_payAuthorizedFee()` costs ~24.5k gas for if a fee is configured and maxFee is set
        _spell(
            address(avoSecondary),
            abi.encodeCall(avoSecondary.payAuthorizedFee, (gasSnapshot_, authorizedParams_.maxFee))
        );
        // @dev ending point for measuring reserve gas should be here. Also see comment in `AvocadoMultisigCore._executeCast()`
    }
}

contract AvocadoMultisig is
    AvocadoMultisigBase,
    AvocadoMultisigCore,
    AvocadoMultisigSelfUpgradeable,
    AvocadoMultisigProtected,
    AvocadoMultisigEIP1271,
    AvocadoMultisigSigners,
    AvocadoMultisigCast,
    AvocadoMultisigCastAuthorized,
    AvocadoMultisigCastChainAgnostic
{
    /***********************************|
    |    CONSTRUCTOR / INITIALIZERS     |
    |__________________________________*/

    /// @notice                        constructor sets multiple immutable values for contracts and payFee fallback logic.
    /// @param avoRegistry_            address of the avoRegistry (proxy) contract
    /// @param avoForwarder_           address of the avoForwarder (proxy) contract
    ///                                to forward tx with valid signatures. must be valid version in AvoRegistry.
    /// @param avoSignersList_         address of the AvoSignersList (proxy) contract
    /// @param avoConfigV1_            AvoConfigV1 contract holding values for authorizedFee values
    /// @param secondary_              AvocadoMultisigSecondary contract for extended logic
    constructor(
        IAvoRegistry avoRegistry_,
        address avoForwarder_,
        IAvoSignersList avoSignersList_,
        IAvoConfigV1 avoConfigV1_,
        IAvocadoMultisigV1Secondary secondary_
    ) AvocadoMultisigBase(avoRegistry_, avoForwarder_, avoSignersList_, avoConfigV1_) AvocadoMultisigCore(secondary_) {
        // sanity checks to ensure all immutables are configured with same values on AvoSecondary
        if (
            address(IAvocadoMultisigV1SecondaryConstants(address(secondary_)).avoRegistry()) != address(avoRegistry_) ||
            IAvocadoMultisigV1SecondaryConstants(address(secondary_)).avoForwarder() != avoForwarder_ ||
            address(IAvocadoMultisigV1SecondaryConstants(address(secondary_)).avoSignersList()) !=
            address(avoSignersList_) ||
            IAvocadoMultisigV1SecondaryConstants(address(secondary_)).AUTHORIZED_MIN_FEE() != AUTHORIZED_MIN_FEE ||
            IAvocadoMultisigV1SecondaryConstants(address(secondary_)).AUTHORIZED_MAX_FEE() != AUTHORIZED_MAX_FEE ||
            IAvocadoMultisigV1SecondaryConstants(address(secondary_)).AUTHORIZED_FEE_COLLECTOR() !=
            AUTHORIZED_FEE_COLLECTOR
        ) {
            revert AvocadoMultisig__InvalidParams();
        }
    }

    /// @inheritdoc IAvocadoMultisigV1Base
    function initialize() public initializer {
        _spell(address(avoSecondary), msg.data);
    }

    /***********************************|
    |            PUBLIC API             |
    |__________________________________*/

    receive() external payable {}

    /// @inheritdoc IAvocadoMultisigV1Base
    function domainSeparatorV4() public view returns (bytes32) {
        return
            _domainSeparatorV4(
                DOMAIN_SEPARATOR_SALT_HASHED // includes block.chainid
            );
    }

    /// @inheritdoc IAvocadoMultisigV1Base
    function domainSeparatorV4ChainAgnostic() public view returns (bytes32) {
        return
            _domainSeparatorV4(
                DOMAIN_SEPARATOR_CHAIN_AGNOSTIC_SALT_HASHED // includes default chain id (634)
            );
    }

    /// @inheritdoc IAvocadoMultisigV1Base
    function isSigner(address signer_) public view returns (bool) {
        address[] memory allowedSigners_ = _getSigners(); // includes owner

        uint256 allowedSignersLength_ = allowedSigners_.length;
        for (uint256 i; i < allowedSignersLength_; ) {
            if (allowedSigners_[i] == signer_) {
                return true;
            }

            unchecked {
                ++i;
            }
        }

        return false;
    }

    /// @inheritdoc IAvocadoMultisigV1Base
    function signers() public view returns (address[] memory signers_) {
        return _getSigners();
    }

    /// @inheritdoc IAvocadoMultisigV1Base
    function requiredSigners() public view returns (uint8) {
        return _getRequiredSigners();
    }

    /// @inheritdoc IAvocadoMultisigV1Base
    function signersCount() public view returns (uint8) {
        return _getSignersCount();
    }

    /// @inheritdoc IAvocadoMultisigV1Base
    function owner() public view returns (address) {
        return IAvocado(address(this))._owner();
    }

    /// @inheritdoc IAvocadoMultisigV1Base
    function index() public view returns (uint32) {
        return uint32(IAvocado(address(this))._data() >> 160);
    }

    /// @notice incrementing nonce for each valid tx executed (to ensure uniqueness)
    function avoNonce() public view returns (uint256) {
        return uint256(_avoNonce);
    }
}
