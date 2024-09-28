// SPDX-License-Identifier: MIT
pragma solidity >=0.8.18;

import { AvocadoMultisigStructs } from "../AvocadoMultisig/AvocadoMultisigStructs.sol";

// @dev base interface without getters for storage variables (to avoid overloads issues)
interface IAvocadoMultisigV1Base is AvocadoMultisigStructs {
    /// @notice initializer called by AvoFactory after deployment, sets the `owner_` as the only signer
    function initialize() external;

    /// @notice returns the domainSeparator for EIP712 signature
    function domainSeparatorV4() external view returns (bytes32);

    /// @notice returns the domainSeparator for EIP712 signature for `castChainAgnostic`
    function domainSeparatorV4ChainAgnostic() external view returns (bytes32);

    /// @notice               gets the digest (hash) used to verify an EIP712 signature for `cast()`.
    ///
    ///                       This is also used as the non-sequential nonce that will be marked as used when the
    ///                       request with the matching `params_` and `forwardParams_` is executed via `cast()`.
    /// @param params_        Cast params such as id, avoNonce and actions to execute
    /// @param forwardParams_ Cast params related to validity of forwarding as instructed and signed
    /// @return               bytes32 digest to verify signature (or used as non-sequential nonce)
    function getSigDigest(
        CastParams calldata params_,
        CastForwardParams calldata forwardParams_
    ) external view returns (bytes32);

    /// @notice                   gets the digest (hash) used to verify an EIP712 signature for `castAuthorized()`.
    ///
    ///                           This is also the non-sequential nonce that will be marked as used when the request
    ///                           with the matching `params_` and `authorizedParams_` is executed via `castAuthorized()`.
    /// @param params_            Cast params such as id, avoNonce and actions to execute
    /// @param authorizedParams_  Cast params related to authorized execution such as maxFee, as signed
    /// @return                   bytes32 digest to verify signature (or used as non-sequential nonce)
    function getSigDigestAuthorized(
        CastParams calldata params_,
        CastAuthorizedParams calldata authorizedParams_
    ) external view returns (bytes32);

    /// @notice                   Verify the signatures for a `cast()' call are valid and can be executed.
    ///                           This does not guarantuee that the tx will not revert, simply that the params are valid.
    ///                           Does not revert and returns successfully if the input is valid.
    ///                           Reverts if input params, signature or avoNonce etc. are invalid.
    /// @param params_            Cast params such as id, avoNonce and actions to execute
    /// @param forwardParams_     Cast params related to validity of forwarding as instructed and signed
    /// @param signaturesParams_  SignatureParams structs array for signature and signer:
    ///                           - signature: the EIP712 signature, 65 bytes ECDSA signature for a default EOA.
    ///                             For smart contract signatures it must fulfill the requirements for the relevant
    ///                             smart contract `.isValidSignature()` EIP1271 logic
    ///                           - signer: address of the signature signer.
    ///                             Must match the actual signature signer or refer to the smart contract
    ///                             that must be an allowed signer and validates signature via EIP1271
    /// @return                   returns true if everything is valid, otherwise reverts
    function verify(
        CastParams calldata params_,
        CastForwardParams calldata forwardParams_,
        SignatureParams[] calldata signaturesParams_
    ) external view returns (bool);

    /// @notice                   Verify the signatures for a `castAuthorized()' call are valid and can be executed.
    ///                           This does not guarantuee that the tx will not revert, simply that the params are valid.
    ///                           Does not revert and returns successfully if the input is valid.
    ///                           Reverts if input params, signature or avoNonce etc. are invalid.
    /// @param params_            Cast params such as id, avoNonce and actions to execute
    /// @param authorizedParams_  Cast params related to authorized execution such as maxFee, as signed
    /// @param signaturesParams_  SignatureParams structs array for signature and signer:
    ///                           - signature: the EIP712 signature, 65 bytes ECDSA signature for a default EOA.
    ///                             For smart contract signatures it must fulfill the requirements for the relevant
    ///                             smart contract `.isValidSignature()` EIP1271 logic
    ///                           - signer: address of the signature signer.
    ///                             Must match the actual signature signer or refer to the smart contract
    ///                             that must be an allowed signer and validates signature via EIP1271
    /// @return                   returns true if everything is valid, otherwise reverts
    function verifyAuthorized(
        CastParams calldata params_,
        CastAuthorizedParams calldata authorizedParams_,
        SignatureParams[] calldata signaturesParams_
    ) external view returns (bool);

    /// @notice                   Executes arbitrary actions with valid signatures. Only executable by AvoForwarder.
    ///                           If one action fails, the transaction doesn't revert, instead emits the `CastFailed` event.
    ///                           In that case, all previous actions are reverted.
    ///                           On success, emits CastExecuted event.
    /// @dev                      validates EIP712 signature then executes each action via .call or .delegatecall
    /// @param params_            Cast params such as id, avoNonce and actions to execute
    /// @param forwardParams_     Cast params related to validity of forwarding as instructed and signed
    /// @param signaturesParams_  SignatureParams structs array for signature and signer:
    ///                           - signature: the EIP712 signature, 65 bytes ECDSA signature for a default EOA.
    ///                             For smart contract signatures it must fulfill the requirements for the relevant
    ///                             smart contract `.isValidSignature()` EIP1271 logic
    ///                           - signer: address of the signature signer.
    ///                             Must match the actual signature signer or refer to the smart contract
    ///                             that must be an allowed signer and validates signature via EIP1271
    /// @return success           true if all actions were executed succesfully, false otherwise.
    /// @return revertReason      revert reason if one of the actions fails in the following format:
    ///                           The revert reason will be prefixed with the index of the action.
    ///                           e.g. if action 1 fails, then the reason will be "1_reason".
    ///                           if an action in the flashloan callback fails (or an otherwise nested action),
    ///                           it will be prefixed with with two numbers: "1_2_reason".
    ///                           e.g. if action 1 is the flashloan, and action 2 of flashloan actions fails,
    ///                           the reason will be 1_2_reason.
    function cast(
        CastParams calldata params_,
        CastForwardParams calldata forwardParams_,
        SignatureParams[] calldata signaturesParams_
    ) external payable returns (bool success, string memory revertReason);

    /// @notice                   Simulates a `cast()` call with exact same params and execution logic except for:
    ///                           - any `gasleft()` use removed to remove potential problems when estimating gas.
    ///                           - reverts on param validations removed (verify validity with `verify` instead).
    ///                           - signature validation is skipped (must be manually added to gas estimations).
    /// @dev                      tx.origin must be dead address, msg.sender must be AvoForwarder.
    /// @dev                      - set `signaturesParams_` to empty to automatically simulate with required signers length.
    ///                           - if `signaturesParams_` first element signature is not set, or if first signer is set to
    ///                             0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF, then gas usage burn is simulated
    ///                             for verify signature functionality. DO NOT set signature to non-empty for subsequent
    ///                             elements then; set all signatures to empty!
    ///                           - if `signaturesParams_` is set normally, signatures are verified as in actual execute
    ///                           - buffer amounts for mock smart contract signers signature verification must be added
    ///                             off-chain as this varies on a case per case basis.
    function simulateCast(
        CastParams calldata params_,
        CastForwardParams calldata forwardParams_,
        SignatureParams[] memory signaturesParams_
    ) external payable returns (bool success_, string memory revertReason_);

    /// @notice                   Exact same as `simulateCast`, just reverts in case of `success_` = false to optimize
    ///                           for use with .estimateGas().
    function estimateCast(
        CastParams calldata params_,
        CastForwardParams calldata forwardParams_,
        SignatureParams[] memory signaturesParams_
    ) external payable returns (bool success_, string memory revertReason_);

    /// @notice                   Executes arbitrary actions through authorized transaction sent with valid signatures.
    ///                           Includes a fee in native network gas token, amount depends on registry `calcFee()`.
    ///                           If one action fails, the transaction doesn't revert, instead emits the `CastFailed` event.
    ///                           In that case, all previous actions are reverted.
    ///                           On success, emits CastExecuted event.
    /// @dev                      executes a .call or .delegateCall for every action (depending on params)
    /// @param params_            Cast params such as id, avoNonce and actions to execute
    /// @param authorizedParams_  Cast params related to authorized execution such as maxFee, as signed
    /// @param signaturesParams_  SignatureParams structs array for signature and signer:
    ///                           - signature: the EIP712 signature, 65 bytes ECDSA signature for a default EOA.
    ///                             For smart contract signatures it must fulfill the requirements for the relevant
    ///                             smart contract `.isValidSignature()` EIP1271 logic
    ///                           - signer: address of the signature signer.
    ///                             Must match the actual signature signer or refer to the smart contract
    ///                             that must be an allowed signer and validates signature via EIP1271
    /// @return success           true if all actions were executed succesfully, false otherwise.
    /// @return revertReason      revert reason if one of the actions fails in the following format:
    ///                           The revert reason will be prefixed with the index of the action.
    ///                           e.g. if action 1 fails, then the reason will be "1_reason".
    ///                           if an action in the flashloan callback fails (or an otherwise nested action),
    ///                           it will be prefixed with with two numbers: "1_2_reason".
    ///                           e.g. if action 1 is the flashloan, and action 2 of flashloan actions fails,
    ///                           the reason will be 1_2_reason.
    function castAuthorized(
        CastParams calldata params_,
        CastAuthorizedParams calldata authorizedParams_,
        SignatureParams[] calldata signaturesParams_
    ) external payable returns (bool success, string memory revertReason);

    /// @notice returns the hashes struct for each `CastChainAgnosticParams` element of `params_`. The returned array must be
    ///         passed into `castChainAgnostic()` as the param `chainAgnosticHashes_` there (order must be the same).
    ///         The returned hash for each element is the EIP712 type hash for `CAST_CHAIN_AGNOSTIC_PARAMS_TYPE_HASH`,
    ///         as used when the signature digest is built.
    function getChainAgnosticHashes(
        CastChainAgnosticParams[] calldata params_
    ) external pure returns (ChainAgnosticHash[] memory chainAgnosticHashes_);

    /// @notice                   gets the digest (hash) used to verify an EIP712 signature for `castChainAgnostic()`,
    ///                           built from the `CastChainAgnosticParams`.
    ///
    ///                           This is also the non-sequential nonce that will be marked as used when the request
    ///                           with the matching `params_` is executed via `castChainAgnostic()`.
    /// @param params_            Cast params such as id, avoNonce and actions to execute
    /// @return                   bytes32 digest to verify signature (or used as non-sequential nonce)
    function getSigDigestChainAgnostic(CastChainAgnosticParams[] calldata params_) external view returns (bytes32);

    /// @notice                     gets the digest (hash) used to verify an EIP712 signature for `castChainAgnostic()`,
    ///                             built from the chain agnostic hashes (result of `getChainAgnosticHashes()`).
    ///
    ///                             This is also the non-sequential nonce that will be marked as used when the request
    ///                             with the matching `params_` is executed via `castChainAgnostic()`.
    /// @param chainAgnosticHashes_ EIP712 type hashes of `CAST_CHAIN_AGNOSTIC_PARAMS_TYPE_HASH` for all `CastChainAgnosticParams`
    ///                             struct array elements as used when creating the signature. Result of `getChainAgnosticHashes()`.
    ///                             must be set in the same order as when creating the signature.
    /// @return                     bytes32 digest to verify signature (or used as non-sequential nonce)
    function getSigDigestChainAgnosticFromHashes(
        ChainAgnosticHash[] calldata chainAgnosticHashes_
    ) external view returns (bytes32);

    /// @notice                     Executes arbitrary actions with valid signatures. Only executable by AvoForwarder.
    ///                             If one action fails, the transaction doesn't revert, instead emits the `CastFailed` event.
    ///                             In that case, all previous actions are reverted.
    ///                             On success, emits CastExecuted event.
    /// @dev                        validates EIP712 signature then executes each action via .call or .delegatecall
    /// @param params_              params containing info and intents regarding actions to be executed. Made up of
    ///                             same params as for `cast()` plus chain id.
    /// @param signaturesParams_    SignatureParams structs array for signature and signer:
    ///                             - signature: the EIP712 signature, 65 bytes ECDSA signature for a default EOA.
    ///                               For smart contract signatures it must fulfill the requirements for the relevant
    ///                               smart contract `.isValidSignature()` EIP1271 logic
    ///                             - signer: address of the signature signer.
    ///                               Must match the actual signature signer or refer to the smart contract
    ///                               that must be an allowed signer and validates signature via EIP1271
    /// @param chainAgnosticHashes_ EIP712 type hashes of `CAST_CHAIN_AGNOSTIC_PARAMS_TYPE_HASH` for all `CastChainAgnosticParams`
    ///                             struct array elements as used when creating the signature. Result of `getChainAgnosticHashes()`.
    ///                             must be set in the same order as when creating the signature.
    /// @return success             true if all actions were executed succesfully, false otherwise.
    /// @return revertReason        revert reason if one of the actions fails in the following format:
    ///                             The revert reason will be prefixed with the index of the action.
    ///                             e.g. if action 1 fails, then the reason will be "1_reason".
    ///                             if an action in the flashloan callback fails (or an otherwise nested action),
    ///                             it will be prefixed with with two numbers: "1_2_reason".
    ///                             e.g. if action 1 is the flashloan, and action 2 of flashloan actions fails,
    ///                             the reason will be 1_2_reason.
    function castChainAgnostic(
        CastChainAgnosticParams calldata params_,
        SignatureParams[] memory signaturesParams_,
        ChainAgnosticHash[] calldata chainAgnosticHashes_
    ) external payable returns (bool success, string memory revertReason);

    /// @notice                   Simulates a `castChainAgnostic()` call with exact same params and execution logic except for:
    ///                           - any `gasleft()` use removed to remove potential problems when estimating gas.
    ///                           - reverts on param validations removed (verify validity with `verify` instead).
    ///                           - signature validation is skipped (must be manually added to gas estimations).
    /// @dev                      tx.origin must be dead address, msg.sender must be AvoForwarder.
    /// @dev                      - set `signaturesParams_` to empty to automatically simulate with required signers length.
    ///                           - if `signaturesParams_` first element signature is not set, or if first signer is set to
    ///                             0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF, then gas usage burn is simulated
    ///                             for verify signature functionality. DO NOT set signature to non-empty for subsequent
    ///                             elements then; set all signatures to empty!
    ///                           - if `signaturesParams_` is set normally, signatures are verified as in actual execute
    ///                           - buffer amounts for mock smart contract signers signature verification must be added
    ///                             off-chain as this varies on a case per case basis.
    function simulateCastChainAgnostic(
        CastChainAgnosticParams calldata params_,
        SignatureParams[] memory signaturesParams_,
        ChainAgnosticHash[] calldata chainAgnosticHashes_
    ) external payable returns (bool success_, string memory revertReason_);

    /// @notice                   Exact same as `simulateCastChainAgnostic`, just reverts in case of `success_` = false to
    ///                           optimize for use with .estimateGas().
    function estimateCastChainAgnostic(
        CastChainAgnosticParams calldata params_,
        SignatureParams[] memory signaturesParams_,
        ChainAgnosticHash[] calldata chainAgnosticHashes_
    ) external payable returns (bool success_, string memory revertReason_);

    /// @notice                     Verify the signatures for a `castChainAgnostic()' call are valid and can be executed.
    ///                             This does not guarantuee that the tx will not revert, simply that the params are valid.
    ///                             Does not revert and returns successfully if the input is valid.
    ///                             Reverts if input params, signature or avoNonce etc. are invalid.
    /// @param params_              params containing info and intents regarding actions to be executed. Made up of
    ///                             same params as for `cast()` plus chain id.
    /// @param signaturesParams_    SignatureParams structs array for signature and signer:
    ///                             - signature: the EIP712 signature, 65 bytes ECDSA signature for a default EOA.
    ///                               For smart contract signatures it must fulfill the requirements for the relevant
    ///                               smart contract `.isValidSignature()` EIP1271 logic
    ///                             - signer: address of the signature signer.
    ///                               Must match the actual signature signer or refer to the smart contract
    ///                               that must be an allowed signer and validates signature via EIP1271
    /// @param chainAgnosticHashes_ EIP712 type hashes of `CAST_CHAIN_AGNOSTIC_PARAMS_TYPE_HASH` for all `CastChainAgnosticParams`
    ///                             struct array elements as used when creating the signature. Result of `getChainAgnosticHashes()`.
    ///                             must be set in the same order as when creating the signature.
    /// @return                     returns true if everything is valid, otherwise reverts
    function verifyChainAgnostic(
        CastChainAgnosticParams calldata params_,
        SignatureParams[] calldata signaturesParams_,
        ChainAgnosticHash[] calldata chainAgnosticHashes_
    ) external view returns (bool);

    /// @notice checks if an address `signer_` is an allowed signer (returns true if allowed)
    function isSigner(address signer_) external view returns (bool);

    /// @notice returns allowed signers on Avocado wich can trigger actions if reaching quorum `requiredSigners`.
    ///         signers automatically include owner.
    function signers() external view returns (address[] memory signers_);

    /// @notice returns the number of required signers
    function requiredSigners() external view returns (uint8);

    /// @notice returns the number of allowed signers
    function signersCount() external view returns (uint8);

    /// @notice Avocado owner
    function owner() external view returns (address);

    /// @notice Avocado index (number of Avocado for EOA owner)
    function index() external view returns (uint32);
}

// @dev full interface with some getters for storage variables
interface IAvocadoMultisigV1 is IAvocadoMultisigV1Base {
    /// @notice Domain separator name for signatures
    function DOMAIN_SEPARATOR_NAME() external view returns (string memory);

    /// @notice Domain separator version for signatures
    function DOMAIN_SEPARATOR_VERSION() external view returns (string memory);

    /// @notice incrementing nonce for each valid tx executed (to ensure uniqueness)
    function avoNonce() external view returns (uint256);
}
