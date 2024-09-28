// SPDX-License-Identifier: MIT
pragma solidity >=0.8.18;

import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { SSTORE2 } from "solmate/src/utils/SSTORE2.sol";
import { Strings } from "@openzeppelin/contracts/utils/Strings.sol";

import { IAvoRegistry } from "../interfaces/IAvoRegistry.sol";
import { IAvoSignersList } from "../interfaces/IAvoSignersList.sol";
import { IAvocadoMultisigV1Secondary } from "../interfaces/IAvocadoMultisigV1Secondary.sol";
import { IAvocado } from "../Avocado.sol";
import { IAvoConfigV1 } from "../interfaces/IAvoConfigV1.sol";
import { AvocadoMultisigBase } from "./AvocadoMultisigCore.sol";
import { AvocadoMultisigProtected, AvocadoMultisigSelfUpgradeable } from "./AvocadoMultisig.sol";

// --------------------------- DEVELOPER NOTES -----------------------------------------
// @dev IMPORTANT: all storage variables go into AvocadoMultisigVariables.sol
// -------------------------------------------------------------------------------------

// empty interface used for Natspec docs for nice layout in automatically generated docs:
//
/// @title  AvocadoMultisigSecondary v1.1.0
/// @notice Extended core logic for `AvocadoMultisig.sol`, which calls this contract via delegateCall (or directly
///         for view/pure methods).
///         This contract is set as immutable on `AvocadoMultisig.sol` and is thus only upgradeable when that contract
///         itself is newly deployed (and consecutively upgraded to by the Avocado owner).
/// @dev    All methods are restricted to be only callable via delegateCall.
interface AvocadoMultisigSecondary_V1 {}

abstract contract AvocadoMultisigSecondaryCore is AvocadoMultisigBase, IAvocadoMultisigV1Secondary {
    address private immutable _ADDRESS_THIS;

    /// @dev ensures the method can only be called by a delegate call.
    modifier onlyDelegateCall() {
        _requireDelegateCalled();
        _;
    }

    /// @dev internal method for modifier logic to reduce bytecode size of contract.
    function _requireDelegateCalled() internal view {
        if (_ADDRESS_THIS == address(this)) {
            revert AvocadoMultisig__Unauthorized();
        }
    }

    constructor() {
        _ADDRESS_THIS = address(this);
    }
}

abstract contract AvocadoMultisigUpgradeTo is AvocadoMultisigSecondaryCore {
    /// @notice upgrade the contract to a new implementation address.
    ///         - Must be a valid version at the AvoRegistry.
    ///         - Can only be self-called (authorization same as for `cast` methods).
    /// @param avoImplementation_       New contract address
    /// @param afterUpgradeHookData_    flexible bytes for custom usage in after upgrade hook logic
    //
    // Implementation must call `_afterUpgradeHook()`
    function upgradeTo(address avoImplementation_, bytes calldata afterUpgradeHookData_) public onlyDelegateCall {
        if (avoImplementation_ == _avoImpl) {
            return;
        }

        // checks that `avoImplementation_` is a valid version at registry. reverts if not.
        avoRegistry.requireValidAvoVersion(avoImplementation_);

        // store previous implementation address to pass to after upgrade hook, for version x > version y specific logic
        address fromImplementation_ = _avoImpl;

        _avoImpl = avoImplementation_;
        emit Upgraded(avoImplementation_);

        // Address.functionDelegateCall will revert if success = false
        Address.functionDelegateCall(
            avoImplementation_,
            abi.encodeCall(
                AvocadoMultisigSelfUpgradeable._afterUpgradeHook,
                (fromImplementation_, afterUpgradeHookData_)
            )
        );
    }
}

abstract contract AvocadoMultisigOccupyNonces is AvocadoMultisigSecondaryCore {
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
    function occupyAvoNonces(uint88[] calldata avoNonces_) external onlyDelegateCall {
        uint256 avoNoncesLength_ = avoNonces_.length;
        if (avoNoncesLength_ == 0) {
            // in case to cancel just one nonce via normal sequential nonce execution itself
            return;
        }

        if (avoNoncesLength_ > 5) {
            revert AvocadoMultisig__InvalidParams();
        }

        uint256 nextAvoNonce_ = _avoNonce;

        for (uint256 i; i < avoNoncesLength_; ) {
            if (avoNonces_[i] == nextAvoNonce_) {
                // nonce to occupy is valid -> must match the current avoNonce
                emit AvoNonceOccupied(nextAvoNonce_);

                nextAvoNonce_++;
            } else if (avoNonces_[i] > nextAvoNonce_) {
                // input nonce is not smaller or equal current nonce -> invalid sorted ascending input params
                revert AvocadoMultisig__InvalidParams();
            }
            // else while nonce to occupy is < current nonce, skip ahead

            unchecked {
                ++i;
            }
        }

        _avoNonce = uint80(nextAvoNonce_);
    }

    /// @notice occupies the `nonSequentialNonces_` in storage. This can be used to cancel / invalidate
    ///         previously signed request(s) because the nonce will be "used" up.
    ///         - Can only be self-called (authorization same as for `cast` methods).
    /// @param  nonSequentialNonces_ the non-sequential nonces to occupy
    function occupyNonSequentialNonces(bytes32[] calldata nonSequentialNonces_) external onlyDelegateCall {
        uint256 nonSequentialNoncesLength_ = nonSequentialNonces_.length;

        for (uint256 i; i < nonSequentialNoncesLength_; ) {
            nonSequentialNonces[nonSequentialNonces_[i]] = 1;

            emit NonSequentialNonceOccupied(nonSequentialNonces_[i]);

            unchecked {
                ++i;
            }
        }
    }
}

abstract contract AvocadoMultisigEIP1271 is AvocadoMultisigSecondaryCore {
    /// @dev length of a normal expected ECDSA signature
    uint256 private constant _SIGNATURE_LENGTH = 65;
    /// @dev signature must be 65 bytes or otherwise at least 90 bytes to be either a multiple
    /// of 85 bytes + prefix or a decodable `SignatureParams` struct array.
    uint256 private constant _MIN_SIGNATURE_LENGTH = 90;
    /// @dev prefix to signal decoding with multiple of 85 bytes is "0xDEC0DE6520" (appending 000000 to get to bytes8)
    bytes8 private constant _PREFIX_SIGNAL = bytes8(uint64(0xdec0de6520000000));
    /// @dev prefix length to cut of is 5 bytes (DE_C0_DE_65_20)
    uint256 private constant _PREFIX_SIGNAL_LENGTH = 5;

    /// @notice decodes `signature` for EIP1271 into `signaturesParams_`
    function decodeEIP1271Signature(
        bytes calldata signature,
        address owner_
    ) external pure returns (SignatureParams[] memory signaturesParams_) {
        // decode signaturesParams_ from bytes signature
        uint256 signatureLength_ = signature.length;

        if (signatureLength_ == _SIGNATURE_LENGTH) {
            // signature must be from owner for a Multisig with requiredSigners = 1, signers=[owner]
            signaturesParams_ = new SignatureParams[](1);
            signaturesParams_[0] = SignatureParams({ signature: signature, signer: owner_ });
        } else if (signatureLength_ < _MIN_SIGNATURE_LENGTH) {
            revert AvocadoMultisig__InvalidEIP1271Signature();
        } else if (bytes8(signature[0:_PREFIX_SIGNAL_LENGTH]) == _PREFIX_SIGNAL) {
            // if signature is prefixed with _PREFIX_SIGNAL ("0xDEC0DE6520") ->
            // signature after the prefix should be divisible by 85
            // (65 bytes signature and 20 bytes signer address) each
            uint256 signaturesCount_;
            unchecked {
                // -_PREFIX_SIGNAL_LENGTH to not count prefix
                signaturesCount_ = (signatureLength_ - _PREFIX_SIGNAL_LENGTH) / 85;
            }
            signaturesParams_ = new SignatureParams[](signaturesCount_);

            for (uint256 i; i < signaturesCount_; ) {
                // used operations can not overflow / underflow
                unchecked {
                    // +_PREFIX_SIGNAL_LENGTH to start after prefix
                    uint256 signerOffset_ = (i * 85) + _SIGNATURE_LENGTH + _PREFIX_SIGNAL_LENGTH;

                    bytes memory signerBytes_ = signature[signerOffset_:signerOffset_ + 20];
                    address signer_;
                    // cast bytes to address in the easiest way via assembly
                    assembly {
                        signer_ := shr(96, mload(add(signerBytes_, 0x20)))
                    }

                    signaturesParams_[i] = SignatureParams({
                        signature: signature[(signerOffset_ - _SIGNATURE_LENGTH):signerOffset_],
                        signer: signer_
                    });

                    ++i;
                }
            }
        } else {
            // multiple signatures are present that should form `SignatureParams[]` through abi.decode
            // @dev this will fail and revert if invalid typed data is passed in
            signaturesParams_ = abi.decode(signature, (SignatureParams[]));
        }

        return signaturesParams_;
    }

    /// @notice Marks a bytes32 `message_` (signature digest) as signed, making it verifiable by EIP-1271 `isValidSignature()`.
    ///         - Can only be self-called (authorization same as for `cast` methods).
    /// @param message_ data hash to be allow-listed as signed
    /// @dev input `message_` is hashed with `domainSeparatorV4()` according to EIP712 typed data (`EIP1271_TYPE_HASH`)
    function signMessage(bytes32 message_) external onlyDelegateCall {
        // hashing with domain separator mitigates any potential replaying on other networks or other Avocados of the same owner
        message_ = ECDSA.toTypedDataHash(
            _domainSeparatorV4(
                DOMAIN_SEPARATOR_SALT_HASHED // includes block.chainid
            ),
            keccak256(abi.encode(EIP1271_TYPE_HASH, message_))
        );

        _signedMessages[message_] = 1;

        emit SignedMessage(message_);
    }

    /// @notice Removes a previously `signMessage()` signed bytes32 `message_` (signature digest).
    ///         - Can only be self-called (authorization same as for `cast` methods).
    /// @param message_ data hash to be removed from allow-listed signatures
    function removeSignedMessage(bytes32 message_) external onlyDelegateCall {
        _signedMessages[message_] = 0;

        emit RemoveSignedMessage(message_);
    }
}

abstract contract AvocadoMultisigPayAuthorizedFee is AvocadoMultisigSecondaryCore {
    /// @notice              pays the fee for `castAuthorized()` calls via the AvoRegistry (or fallback)
    /// @param gasUsedFrom_  `gasleft()` snapshot at gas measurement starting point
    /// @param maxFee_       maximum acceptable fee to be paid, revert if fee is bigger than this value
    function payAuthorizedFee(uint256 gasUsedFrom_, uint256 maxFee_) external payable onlyDelegateCall {
        // @dev part below costs ~24k gas for if `feeAmount_` and `maxFee_` is set
        uint256 feeAmount_;
        address payable feeCollector_;
        {
            uint256 gasUsed_;
            unchecked {
                // gas can not underflow
                // gasUsed already includes everything at this point except for paying fee logic
                gasUsed_ = gasUsedFrom_ - gasleft();
            }

            // Using a low-level function call to prevent reverts (making sure the contract is truly non-custodial).
            // also limit gas, so that registry can not cause out of gas.
            (bool success_, bytes memory result_) = address(avoRegistry).staticcall{ gas: 15000 }(
                abi.encodeWithSignature("calcFee(uint256)", gasUsed_)
            );

            // checks to ensure decoding does not fail, breaking non-custodial feature
            uint256 addressValue;
            assembly {
                addressValue := mload(add(result_, 0x40))
            }
            if (success_ && result_.length > 63 && addressValue <= type(uint160).max) {
                // result bytes length < 64 or a too long address value would fail the abi.decode and cause revert
                (feeAmount_, feeCollector_) = abi.decode(result_, (uint256, address));
                if (feeAmount_ > AUTHORIZED_MAX_FEE) {
                    // make sure AvoRegistry fee is capped
                    feeAmount_ = AUTHORIZED_MAX_FEE;
                }
            } else {
                // registry calcFee failed. Use local backup minimum fee
                feeCollector_ = AUTHORIZED_FEE_COLLECTOR;
                feeAmount_ = AUTHORIZED_MIN_FEE;
            }
        }

        // pay fee, if any
        if (feeAmount_ > 0) {
            if (maxFee_ > 0 && feeAmount_ > maxFee_) {
                revert AvocadoMultisig__MaxFee(feeAmount_, maxFee_);
            }

            // sending fee based on OZ Address.sendValue, but modified to properly act based on actual error case
            // (https://github.com/OpenZeppelin/openzeppelin-contracts/blob/release-v4.8/contracts/utils/Address.sol#L60)
            if (address(this).balance < feeAmount_) {
                revert AvocadoMultisig__InsufficientBalance(feeAmount_);
            }

            // Setting gas to very low 1000 because 2_300 gas is added automatically for a .call with a value amount.
            // This should be enough for any normal transfer to an EOA or an Avocado Multisig.
            (bool success_, ) = feeCollector_.call{ value: feeAmount_, gas: 1000 }("");

            if (success_) {
                emit FeePaid(feeAmount_);
            } else {
                // do not revert, as an error on the feeCollector_ side should not be the "fault" of the Avo contract.
                // Letting this case pass ensures that the contract is truly non-custodial (not blockable by feeCollector)
                emit FeePayFailed(feeAmount_);
            }
        } else {
            emit FeePaid(feeAmount_);
        }
    }
}

abstract contract AvocadoMultisigSigners is AvocadoMultisigSecondaryCore {
    /// @notice adds `addSigners_` to allowed signers and sets required signers count to `requiredSigners_`
    /// Note the `addSigners_` to be added must:
    ///     - NOT be duplicates (already present in current allowed signers)
    ///     - NOT be the zero address
    ///     - be sorted ascending
    function addSigners(address[] calldata addSigners_, uint8 requiredSigners_) external onlyDelegateCall {
        uint256 addSignersLength_ = addSigners_.length;

        // check array length and make sure signers can not be zero address
        // (only check for first elem needed, rest is checked through sort)
        if (addSignersLength_ == 0 || addSigners_[0] == address(0)) {
            revert AvocadoMultisig__InvalidParams();
        }

        address[] memory currentSigners_ = _getSigners();
        uint256 currentSignersLength_ = currentSigners_.length;

        uint256 newSignersLength_ = currentSignersLength_ + addSignersLength_;
        if (newSignersLength_ > MAX_SIGNERS_COUNT) {
            revert AvocadoMultisig__InvalidParams();
        }
        address[] memory newSigners_ = new address[](newSignersLength_);

        uint256 currentSignersPos_ = 0; // index of position of loop in currentSigners_ array
        uint256 addedCount_ = 0; // keep track of number of added signers of current signers array
        for (uint256 i; i < newSignersLength_; ) {
            unchecked {
                currentSignersPos_ = i - addedCount_;
            }

            if (
                addedCount_ == addSignersLength_ ||
                (currentSignersPos_ < currentSignersLength_ &&
                    currentSigners_[currentSignersPos_] < addSigners_[addedCount_])
            ) {
                // if already added all signers or if current signer is <  next signer, keep the current one
                newSigners_[i] = currentSigners_[currentSignersPos_];
            } else {
                //  add signer
                newSigners_[i] = addSigners_[addedCount_];

                emit SignerAdded(addSigners_[addedCount_]);

                unchecked {
                    ++addedCount_;
                }
            }

            if (i > 0 && newSigners_[i] <= newSigners_[i - 1]) {
                // make sure input signers are ordered ascending and no duplicate signers are added
                revert AvocadoMultisig__InvalidParams();
            }

            unchecked {
                ++i;
            }
        }

        // update values in storage
        _setSigners(newSigners_, requiredSigners_); // updates `signersCount`, checks and sets `requiredSigners_`

        // sync mappings at AvoSignersList -> must happen *after* storage write update
        // use call with success_ here to not block users transaction if the helper contract fails.
        // in case of failure, only emit event ListSyncFailed() so off-chain tracking is informed to react.
        (bool success_, ) = address(avoSignersList).call(
            abi.encodeCall(IAvoSignersList.syncAddAvoSignerMappings, (address(this), addSigners_))
        );
        if (!success_) {
            emit ListSyncFailed();
        }
    }

    /// @notice removes `removeSigners_` from allowed signers and sets required signers count to `requiredSigners_`
    /// Note the `removeSigners_` to be removed must:
    ///     - NOT be the owner
    ///     - be sorted ascending
    ///     - be present in current allowed signers
    function removeSigners(address[] calldata removeSigners_, uint8 requiredSigners_) external onlyDelegateCall {
        uint256 removeSignersLength_ = removeSigners_.length;
        if (removeSignersLength_ == 0) {
            revert AvocadoMultisig__InvalidParams();
        }

        address[] memory currentSigners_ = _getSigners();
        uint256 currentSignersLength_ = currentSigners_.length;

        uint256 newSignersLength_ = currentSignersLength_ - removeSignersLength_;

        address owner_ = IAvocado(address(this))._owner();

        address[] memory newSigners_ = new address[](newSignersLength_);

        uint256 currentInsertPos_ = 0; // index of position of loop in `newSigners_` array
        uint256 removedCount_ = 0; // keep track of number of removed signers of current signers array
        for (uint256 i; i < currentSignersLength_; ) {
            unchecked {
                currentInsertPos_ = i - removedCount_;
            }
            if (removedCount_ == removeSignersLength_ || currentSigners_[i] != removeSigners_[removedCount_]) {
                // if already removed all signers or if current signer is not a signer to be removed, keep the current one
                if (currentInsertPos_ < newSignersLength_) {
                    // make sure index to insert is within bounds of newSigners_ array
                    newSigners_[currentInsertPos_] = currentSigners_[i];
                } else {
                    // a signer has been passed in that was not found and thus we would be inserting at a position
                    // in newSigners_ array that overflows its length
                    revert AvocadoMultisig__InvalidParams();
                }
            } else {
                // remove signer, i.e. do not insert the current signer in the newSigners_ array

                // make sure signer to be removed is not the owner
                if (removeSigners_[removedCount_] == owner_) {
                    revert AvocadoMultisig__InvalidParams();
                }

                emit SignerRemoved(removeSigners_[removedCount_]);

                unchecked {
                    ++removedCount_;
                }
            }

            unchecked {
                ++i;
            }
        }

        if (removedCount_ != removeSignersLength_) {
            // this case should not be possible but it is a good cheap extra check to make sure nothing goes wrong
            // and the contract does not end up in an invalid signers state
            revert AvocadoMultisig__InvalidParams();
        }

        // update values in storage
        _setSigners(newSigners_, requiredSigners_); // updates `signersCount`, checks and sets `requiredSigners_`

        // sync mappings at AvoSignersList -> must happen *after* storage write update
        // use call with success_ here to not block users transaction if the helper contract fails.
        // in case of failure, only emit event ListSyncFailed() so off-chain tracking is informed to react.
        (bool success_, ) = address(avoSignersList).call(
            abi.encodeCall(IAvoSignersList.syncRemoveAvoSignerMappings, (address(this), removeSigners_))
        );
        if (!success_) {
            emit ListSyncFailed();
        }
    }

    /// @notice sets number of required signers for a valid request to `requiredSigners_`
    function setRequiredSigners(uint8 requiredSigners_) external onlyDelegateCall {
        _setRequiredSigners(requiredSigners_);
    }

    /***********************************|
    |               INTERNAL            |
    |__________________________________*/

    /// @dev writes `signers_` to storage with SSTORE2 and updates `signersCount`. uses `requiredSigners_` for sanity checks
    function _setSigners(address[] memory signers_, uint8 requiredSigners_) internal {
        uint256 signersCount_ = signers_.length;

        if (signersCount_ > MAX_SIGNERS_COUNT || signersCount_ == 0) {
            revert AvocadoMultisig__InvalidParams();
        }

        if (signersCount_ == 1) {
            // if signersCount is 1, owner must be the only signer (checked in `removeSigners`)
            // can reset to empty "uninitialized" signer vars state, making subsequent interactions cheaper
            // and even giving a gas refund for clearing out the slot 1
            if (requiredSigners_ != 1) {
                revert AvocadoMultisig__InvalidParams();
            }
            if (_requiredSigners > 1) {
                emit RequiredSignersSet(1);
            }

            assembly {
                sstore(1, 0) // Reset slot 1 (signers related vars) to 0
            }
        } else {
            _signersCount = uint8(signersCount_);

            _signersPointer = SSTORE2.write(abi.encode(signers_));

            // required signers vs signersCount is checked in _setRequiredSigners
            _setRequiredSigners(requiredSigners_);
        }
    }

    /// @dev sets number of required signers to `requiredSigners_` and emits event RequiredSignersSet, if valid
    function _setRequiredSigners(uint8 requiredSigners_) internal {
        // check if number of actual signers is > `requiredSigners_` because otherwise
        // the multisig would end up in a broken state where no execution is possible anymore
        if (requiredSigners_ == 0 || requiredSigners_ > _getSignersCount()) {
            revert AvocadoMultisig__InvalidParams();
        }

        if (_requiredSigners != requiredSigners_) {
            _requiredSigners = requiredSigners_;

            emit RequiredSignersSet(requiredSigners_);
        }
    }
}

abstract contract AvocadoMultisigInitialize is AvocadoMultisigSecondaryCore {
    /// @notice sets the initial state of the Multisig for `owner_` as owner and first and only required signer
    function initialize() external onlyDelegateCall {
        address owner_ = IAvocado(address(this))._owner();

        // owner must be EOA
        if (Address.isContract(owner_) || owner_ == address(0)) {
            revert AvocadoMultisig__InvalidParams();
        }

        // set _transientAllowHash so refund behaviour is already active for first tx and this cost is applied to deployment
        _resetTransientStorage();

        // emit events
        emit SignerAdded(owner_);
        emit RequiredSignersSet(1);

        // add owner as signer at AvoSignersList
        address[] memory signers_ = new address[](1);
        signers_[0] = owner_;
        // use call with success_ here to not block users transaction if the helper contract fails.
        // in case of failure, only emit event ListSyncFailed() so off-chain tracking is informed to react.
        (bool success_, ) = address(avoSignersList).call(
            abi.encodeCall(IAvoSignersList.syncAddAvoSignerMappings, (address(this), signers_))
        );
        if (!success_) {
            emit ListSyncFailed();
        }
    }
}

abstract contract AvocadoMultisigRevertReason is AvocadoMultisigSecondaryCore {
    /// @notice Get the revert reason from the returnedData (supports Panic, Error & Custom Errors).
    /// @param returnedData_ revert data of the call
    /// @return reason_      revert reason
    //
    // Based on https://github.com/superfluid-finance/protocol-monorepo/blob/dev/packages/ethereum-contracts/contracts/libs/CallUtils.sol
    // This is needed in order to provide some human-readable revert message from a call.
    function getRevertReasonFromReturnedData(bytes memory returnedData_) public pure returns (string memory reason_) {
        if (returnedData_.length < 4) {
            // case 1: catch all
            return "_REASON_NOT_DEFINED";
        }

        bytes4 errorSelector_;
        assembly {
            errorSelector_ := mload(add(returnedData_, 0x20))
        }
        if (errorSelector_ == bytes4(0x4e487b71)) {
            // case 2: Panic(uint256), selector 0x4e487b71 (Defined since 0.8.0)
            // ref: https://docs.soliditylang.org/en/v0.8.0/control-structures.html#panic-via-assert-and-error-via-require)

            // convert last byte to hex digits -> string to decode the panic code
            assembly {
                returnedData_ := add(returnedData_, 0x04) // skip error selector
            }
            reason_ = string.concat("_TARGET_PANICKED: ", Strings.toHexString(uint256(bytes32(returnedData_))));
        } else if (errorSelector_ == bytes4(0x08c379a0)) {
            // case 3: Error(string), selector 0x08c379a0 (Defined at least since 0.7.0)
            // based on https://ethereum.stackexchange.com/a/83577
            assembly {
                returnedData_ := add(returnedData_, 0x04) // skip error selector
            }
            reason_ = string.concat("_", abi.decode(returnedData_, (string)));
        } else {
            // case 4: Custom errors (Defined since 0.8.0)

            // convert bytes4 selector to string
            reason_ = string.concat("_CUSTOM_ERROR: ", Strings.toHexString(uint256(uint32(errorSelector_))));

            // decode custom error params if there are any, they are returned raw as hex string,
            // up to a length of `REVERT_REASON_MAX_LENGTH`
            uint256 paramsLength_ = (returnedData_.length - 4);
            if (paramsLength_ * 2 > REVERT_REASON_MAX_LENGTH + 8) {
                paramsLength_ = REVERT_REASON_MAX_LENGTH + 4;
            }
            bytes memory result_ = new bytes(paramsLength_ * 2);

            for (uint256 i; i < paramsLength_; ) {
                // use unchecked as i is < 4 and division.
                unchecked {
                    result_[2 * i] = _toHexDigit(uint8(returnedData_[i + 4]) / 16);
                    result_[2 * i + 1] = _toHexDigit(uint8(returnedData_[i + 4]) % 16);
                    ++i;
                }
            }

            reason_ = string.concat(reason_, ". PARAMS_RAW: ");
            reason_ = string.concat(reason_, string(result_));
        }

        {
            // truncate reason_ string to REVERT_REASON_MAX_LENGTH for reserveGas used to ensure Cast event is emitted
            if (bytes(reason_).length > REVERT_REASON_MAX_LENGTH) {
                bytes memory reasonBytes_ = bytes(reason_);
                uint256 maxLength_ = REVERT_REASON_MAX_LENGTH + 1; // cheaper than <= in each loop
                bytes memory truncatedRevertReason_ = new bytes(maxLength_);
                for (uint256 i; i < maxLength_; ) {
                    truncatedRevertReason_[i] = reasonBytes_[i];

                    unchecked {
                        ++i;
                    }
                }
                reason_ = string(truncatedRevertReason_);
            }
        }
    }

    /// @dev used to convert bytes4 selector to string
    function _toHexDigit(uint8 d) internal pure returns (bytes1) {
        // use unchecked as the operations with d can not over / underflow
        unchecked {
            if (d < 10) {
                return bytes1(uint8(bytes1("0")) + d);
            }
            if (d < 16) {
                return bytes1(uint8(bytes1("a")) + d - 10);
            }
        }
        revert AvocadoMultisig__ToHexDigit();
    }
}

abstract contract AvocadoMultisigSimulate is AvocadoMultisigSecondaryCore, AvocadoMultisigRevertReason {
    /// @notice                     executes a SIMULATE cast process for `cast()` or `castChainAgnostic()` for gas estimations.
    /// @dev                        - set `signaturesParams_` to empty to automatically simulate with required signers length.
    ///                             - if `signaturesParams_` first element signature is not set, or if first signer is set to
    ///                               0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF, then gas usage burn is simulated
    ///                               for verify signature functionality. DO NOT set signature to non-empty for subsequent
    ///                               elements then; set all signatures to empty!
    ///                             - if `signaturesParams_` is set normally, signatures are verified as in actual execute
    ///                             - buffer amounts for mock smart contract signers signature verification must be added
    ///                               off-chain as this varies on a case per case basis.
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
    function simulateCast(
        CastParams calldata params_,
        CastForwardParams calldata forwardParams_,
        SignatureParams[] memory signaturesParams_,
        ChainAgnosticHash[] memory chainAgnosticHashes_
    ) public onlyDelegateCall returns (bool success_, string memory revertReason_) {
        _simulateValidateParams(
            params_.actions.length,
            params_.avoNonce,
            forwardParams_.validAfter,
            forwardParams_.validUntil,
            forwardParams_.value
        );

        if (chainAgnosticHashes_.length > 0) {
            // validate that input `CastParams` and `CastForwardParams` are present in `chainAgnosticHashes_`
            _simulateValidateChainAgnostic(
                _castChainAgnosticParamsHash(params_, forwardParams_, block.chainid),
                chainAgnosticHashes_
            );
        }

        bytes32 digest_ = chainAgnosticHashes_.length > 0
            ? _getSigDigestChainAgnostic(chainAgnosticHashes_)
            : _getSigDigest(params_, forwardParams_);

        // if signaturesParams is not set, we use required signers to simulate gas usage
        address[] memory signers_ = new address[](
            signaturesParams_.length > 0 ? signaturesParams_.length : _getRequiredSigners()
        );
        if (
            signaturesParams_.length == 0 ||
            signaturesParams_[0].signature.length == 0 ||
            signaturesParams_[0].signer == 0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF
        ) {
            // simulate verify sig by burning gas according to the measurements as listed in comments in
            // _verifySig` in AvocadoMultisigCore.

            uint256 signersCount_ = uint256(_getSignersCount());
            // Avoado signersCount == 1 ? -> 11_000 gas. If only owner is signer then it is cheaper -> 8_500 gas.
            uint256 verifySigGas_ = signersCount_ == 1 ? 8500 : 11_000;
            // Avoado signersCount > 1 ? -> 6400  + allowedSignersCount * 160 + signersLength * 6900
            if (signers_.length > 1) {
                verifySigGas_ = 6_400 + (signersCount_ * 160) + (signers_.length * 6_900);
            }
            // is non Sequential nonce? + 2200
            if (params_.avoNonce == -1) {
                verifySigGas_ += 2_200;
            }
            if (signaturesParams_.length == 0) {
                // calldata etc. cost per signaturesParams array element is ~3.300 gas
                verifySigGas_ += (signers_.length * 3_300);
            }
            // is smart contract signer buffer amount is external contract dependent, must be added off-chain

            // waste the gas `verifySigGas_` to correctly account for gas usage in estimateGas calls
            uint256 gasLeft_ = gasleft();
            uint256 wasteGasCounter_;
            while (gasLeft_ - gasleft() < verifySigGas_) wasteGasCounter_++;
        } else {
            signers_ = _verifySigWithRevert(digest_, signaturesParams_, params_.avoNonce == -1);
        }

        {
            (success_, revertReason_) = _simulateExecuteCast(
                params_,
                _dynamicReserveGas(CAST_EVENTS_RESERVE_GAS, signers_.length, params_.metadata.length),
                params_.avoNonce == -1 ? digest_ : bytes32(0)
            );
        }

        if (success_) {
            emit CastExecuted(params_.source, msg.sender, signers_, params_.metadata);
        } else {
            emit CastFailed(params_.source, msg.sender, signers_, revertReason_, params_.metadata);
        }
    }

    /// @dev SIMULATES: executes `actions_` with respective target, calldata, operation etc.
    //
    // this is called by _callTargets() and executeOperation() in AvocadoMultisig.sol when the tx.origin is dead address.
    // making this public and calling via delegateCall reduces code duplication and simplifies simulation logic.
    function _simulateExecuteActions(
        Action[] memory actions_,
        uint256 id_,
        bool isFlashloanCallback_
    ) external onlyDelegateCall {
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

                // low-level call will return success true also if action target is not even a contract.
                // we do not explicitly check for this, default interaction is via UI which can check and handle this.
                // Also applies to delegatecall etc.
                (success_, result_) = action_.target.call{ value: action_.value }(action_.data);

                // handle action failure right after external call to better detect out of gas errors
                if (!success_) {
                    _simulateHandleActionFailure(actionMinGasLeft_, i, result_);
                }
            } else if (action_.operation == 1 && isDelegateCallId_) {
                // delegatecall (operation = 1 & id = mixed(1 / 21))
                (success_, result_) = action_.target.delegatecall(action_.data);

                // handle action failure right after external call to better detect out of gas errors
                if (!success_) {
                    _simulateHandleActionFailure(actionMinGasLeft_, i, result_);
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

                // handle action failure right after external call to better detect out of gas errors
                (success_, result_) = action_.target.call{ value: action_.value }(action_.data);

                if (!success_) {
                    _simulateHandleActionFailure(actionMinGasLeft_, i, result_);
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

    /***********************************|
    |              INTERNAL             |
    |__________________________________*/

    /// @dev SIMULATES: executes multiple cast actions according to CastParams `params_`, reserving `reserveGas_` in this contract.
    /// Uses a sequential nonce unless `nonSequentialNonce_` is set.
    /// @return success_ boolean flag indicating whether all actions have been executed successfully.
    /// @return revertReason_ if `success_` is false, then revert reason is returned as string here.
    function _simulateExecuteCast(
        CastParams calldata params_,
        uint256 /** reserveGas_ */,
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
        // using inline assembly for delegatecall to define custom gas amount that should stay here in caller
        assembly {
            success_ := delegatecall(
                gas(), // send all remaining gas for simulate
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

        if (!success_) {
            if (result_.length == 0) {
                revertReason_ = "AVO__REASON_NOT_DEFINED";
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

    /// @dev SIMULATES: handles failure of an action execution depending on error cause,
    /// decoding and reverting with `result_` as reason string.
    function _simulateHandleActionFailure(
        uint256 /** actionMinGasLeft_ */,
        uint256 i_,
        bytes memory result_
    ) internal pure {
        revert(string.concat(Strings.toString(i_), getRevertReasonFromReturnedData(result_)));
    }

    /// @dev                   SIMULATES: Validates input params, reverts on invalid values.
    /// @param actionsLength_  the length of the actions array to execute
    /// @param avoNonce_       the avoNonce from input CastParams
    /// @param validAfter_     timestamp after which the request is valid
    /// @param validUntil_     timestamp before which the request is valid
    /// @param value_          the msg.value expected to be sent along
    function _simulateValidateParams(
        uint256 actionsLength_,
        int256 avoNonce_,
        uint256 validAfter_,
        uint256 validUntil_,
        uint256 value_
    ) internal view {
        // make sure actions are defined and nonce is valid:
        // must be -1 to use a non-sequential nonce or otherwise it must match the avoNonce
        if (!(actionsLength_ > 0 && (avoNonce_ == -1 || uint256(avoNonce_) == _avoNonce))) {
            // revert AvocadoMultisig__InvalidParams(); // no revert on simulate
        }

        // make sure request is within valid timeframe
        if ((validAfter_ > block.timestamp) || (validUntil_ > 0 && validUntil_ < block.timestamp)) {
            // revert AvocadoMultisig__InvalidTiming(); // no revert on simulate
        }

        // make sure msg.value matches `value_` (if set)
        if (value_ > 0 && msg.value != value_) {
            // revert AvocadoMultisig__InvalidParams(); // no revert on simulate
        }
    }

    /// @dev SIMULATES: Validates input params for `castChainAgnostic`: verifies that the `curCastChainAgnosticHash_` is present in
    ///      the `castChainAgnosticHashes_` array of hashes. Reverts with `AvocadoMultisig__InvalidParams` if not.
    ///      Reverts with `AvocadoMultisig__ChainAgnosticChainMismatch` if the hash is present but valid for another chain.
    function _simulateValidateChainAgnostic(
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
        // revert AvocadoMultisig__InvalidParams(); // no revert on simulate
    }
}

contract AvocadoMultisigSecondary is
    AvocadoMultisigBase,
    AvocadoMultisigSecondaryCore,
    AvocadoMultisigUpgradeTo,
    AvocadoMultisigOccupyNonces,
    AvocadoMultisigEIP1271,
    AvocadoMultisigPayAuthorizedFee,
    AvocadoMultisigSigners,
    AvocadoMultisigInitialize,
    AvocadoMultisigRevertReason,
    AvocadoMultisigSimulate
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
    constructor(
        IAvoRegistry avoRegistry_,
        address avoForwarder_,
        IAvoSignersList avoSignersList_,
        IAvoConfigV1 avoConfigV1_
    ) AvocadoMultisigBase(avoRegistry_, avoForwarder_, avoSignersList_, avoConfigV1_) {}
}
