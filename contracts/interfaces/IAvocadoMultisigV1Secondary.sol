// SPDX-License-Identifier: MIT
pragma solidity >=0.8.18;

import { IAvoRegistry } from "./IAvoRegistry.sol";
import { IAvoSignersList } from "./IAvoSignersList.sol";

import { AvocadoMultisigStructs } from "../AvocadoMultisig/AvocadoMultisigStructs.sol";

interface IAvocadoMultisigV1Secondary {
    /// @notice             pays the fee for `castAuthorized()` calls via the AvoRegistry (or fallback)
    /// @param gasUsedFrom_ `gasleft()` snapshot at gas measurement starting point
    /// @param maxFee_      maximum acceptable fee to be paid, revert if fee is bigger than this value
    function payAuthorizedFee(uint256 gasUsedFrom_, uint256 maxFee_) external payable;

    /// @notice decodes `signature` for EIP1271 into `signaturesParams_`
    function decodeEIP1271Signature(
        bytes calldata signature,
        address owner_
    ) external pure returns (AvocadoMultisigStructs.SignatureParams[] memory signaturesParams_);

    /// @notice Get the revert reason from the returnedData (supports Panic, Error & Custom Errors).
    /// @param returnedData_ revert data of the call
    /// @return reason_      revert reason
    function getRevertReasonFromReturnedData(bytes memory returnedData_) external pure returns (string memory reason_);

    /// @notice upgrade the contract to a new implementation address.
    ///         - Must be a valid version at the AvoRegistry.
    ///         - Can only be self-called (authorization same as for `cast` methods).
    /// @param avoImplementation_       New contract address
    /// @param afterUpgradeHookData_    flexible bytes for custom usage in after upgrade hook logic
    //
    // Implementation must call `_afterUpgradeHook()`
    function upgradeTo(address avoImplementation_, bytes calldata afterUpgradeHookData_) external;

    /// @notice                     executes a SIMULATE cast process for `cast()` or `castChainAgnostic()` for gas estimations.
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
        AvocadoMultisigStructs.CastParams calldata params_,
        AvocadoMultisigStructs.CastForwardParams calldata forwardParams_,
        AvocadoMultisigStructs.SignatureParams[] memory signaturesParams_,
        AvocadoMultisigStructs.ChainAgnosticHash[] memory chainAgnosticHashes_
    ) external returns (bool success_, string memory revertReason_);

    /// @notice SIMULATES: executes `actions_` with respective target, calldata, operation etc.
    function _simulateExecuteActions(
        AvocadoMultisigStructs.Action[] memory actions_,
        uint256 id_,
        bool isFlashloanCallback_
    ) external;
}

interface IAvocadoMultisigV1SecondaryConstants {
    function avoRegistry() external view returns (IAvoRegistry);
    function avoForwarder() external view returns (address);
    function avoSignersList() external view returns (IAvoSignersList);
    function AUTHORIZED_MIN_FEE() external view returns (uint256);
    function AUTHORIZED_MAX_FEE() external view returns (uint256);
    function AUTHORIZED_FEE_COLLECTOR() external view returns (address);
}
