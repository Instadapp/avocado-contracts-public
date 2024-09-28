// SPDX-License-Identifier: MIT
pragma solidity >=0.8.18;

abstract contract AvocadoMultisigEvents {
    /// @notice Emitted when the implementation is upgraded to a new logic contract
    event Upgraded(address indexed newImplementation);

    /// @notice Emitted when a message is marked as allowed smart contract signature
    event SignedMessage(bytes32 indexed messageHash);

    /// @notice Emitted when a previously allowed signed message is removed
    event RemoveSignedMessage(bytes32 indexed messageHash);

    /// @notice emitted when the avoNonce in storage is increased through an authorized call to
    /// `occupyAvoNonces()`, which can be used to cancel a previously signed request
    event AvoNonceOccupied(uint256 indexed occupiedAvoNonce);

    /// @notice emitted when a non-sequential nonce is occupied in storage through an authorized call to
    /// `useNonSequentialNonces()`, which can be used to cancel a previously signed request
    event NonSequentialNonceOccupied(bytes32 indexed occupiedNonSequentialNonce);

    /// @notice Emitted when a fee is paid through use of the `castAuthorized()` method
    event FeePaid(uint256 indexed fee);

    /// @notice Emitted when paying a fee reverts at the recipient
    event FeePayFailed(uint256 indexed fee);

    /// @notice emitted when syncing to the AvoSignersList fails
    event ListSyncFailed();

    /// @notice emitted when all actions are executed successfully.
    /// caller = owner / AvoForwarder address. signers = addresses that triggered this execution
    event CastExecuted(address indexed source, address indexed caller, address[] signers, bytes metadata);

    /// @notice emitted if one of the executed actions fails. The reason will be prefixed with the index of the action.
    /// e.g. if action 1 fails, then the reason will be 1_reason
    /// if an action in the flashloan callback fails, it will be prefixed with with two numbers:
    /// e.g. if action 1 is the flashloan, and action 2 of flashloan actions fails, the reason will be 1_2_reason.
    /// caller = owner / AvoForwarder address. signers = addresses that triggered this execution
    /// Note If the signature was invalid, the `signers` array last set element is the signer that caused the revert
    event CastFailed(address indexed source, address indexed caller, address[] signers, string reason, bytes metadata);

    /// @notice emitted when a signer is added as Multisig signer
    event SignerAdded(address indexed signer);

    /// @notice emitted when a signer is removed as Multisig signer
    event SignerRemoved(address indexed signer);

    /// @notice emitted when the required signers count is updated
    event RequiredSignersSet(uint8 indexed requiredSigners);
}
