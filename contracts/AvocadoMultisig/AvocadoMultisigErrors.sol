// SPDX-License-Identifier: MIT
pragma solidity >=0.8.18;

abstract contract AvocadoMultisigErrors {
    /// @notice thrown when a method is called with invalid params (e.g. a zero address as input param)
    error AvocadoMultisig__InvalidParams();

    /// @notice thrown when a signature is not valid (e.g. not signed by enough allowed signers)
    error AvocadoMultisig__InvalidSignature();

    /// @notice thrown when someone is trying to execute a in some way auth protected logic
    error AvocadoMultisig__Unauthorized();

    /// @notice thrown when forwarder/relayer does not send enough gas as the user has defined.
    ///         this error should not be blamed on the user but rather on the relayer
    error AvocadoMultisig__InsufficientGasSent();

    /// @notice thrown when a signature has expired or when a request isn't valid yet
    error AvocadoMultisig__InvalidTiming();

    /// @notice thrown when _toHexDigit() fails
    error AvocadoMultisig__ToHexDigit();

    /// @notice thrown when an EIP1271 signature is invalid
    error AvocadoMultisig__InvalidEIP1271Signature();

    /// @notice thrown when a `castAuthorized()` `fee` is bigger than the `maxFee` given through the input param
    error AvocadoMultisig__MaxFee(uint256 fee, uint256 maxFee);

    /// @notice thrown when `castAuthorized()` fee can not be covered by available contract funds
    error AvocadoMultisig__InsufficientBalance(uint256 fee);
}
