// SPDX-License-Identifier: MIT
pragma solidity >=0.8.18;

interface AvocadoMultisigStructs {
    /// @notice a combination of a bytes signature and its signer.
    struct SignatureParams {
        ///
        /// @param signature ECDSA signature of `getSigDigest()` for default flow or EIP1271 smart contract signature
        bytes signature;
        ///
        /// @param signer signer of the signature. Can be set to smart contract address that supports EIP1271
        address signer;
    }

    /// @notice an arbitrary executable action
    struct Action {
        ///
        /// @param target the target address to execute the action on
        address target;
        ///
        /// @param data the calldata to be passed to the call for each target
        bytes data;
        ///
        /// @param value the msg.value to be passed to the call for each target. set to 0 if none
        uint256 value;
        ///
        /// @param operation type of operation to execute:
        /// 0 -> .call; 1 -> .delegateCall, 2 -> flashloan (via .call)
        uint256 operation;
    }

    /// @notice common params for both `cast()` and `castAuthorized()`
    struct CastParams {
        Action[] actions;
        ///
        /// @param id             Required:
        ///                       id for actions, e.g. 0 = CALL, 1 = MIXED (call and delegatecall),
        ///                                           20 = FLASHLOAN_CALL, 21 = FLASHLOAN_MIXED
        uint256 id;
        ///
        /// @param avoNonce   Required:
        ///                       avoNonce to be used for this tx. Must equal the avoNonce value on smart
        ///                       wallet or alternatively it must be set to -1 to use a non-sequential nonce instead
        int256 avoNonce;
        ///
        /// @param salt           Optional:
        ///                       Salt to customize non-sequential nonce (if `avoNonce` is set to -1)
        bytes32 salt;
        ///
        /// @param source         Optional:
        ///                       Source / referral for this tx
        address source;
        ///
        /// @param metadata       Optional:
        ///                       metadata for any potential additional data to be tracked in the tx
        bytes metadata;
    }

    /// @notice `cast()` input params related to forwarding validity
    struct CastForwardParams {
        ///
        /// @param gas            Optional:
        ///                       As EIP-2770: user instructed minimum amount of gas that the relayer (AvoForwarder)
        ///                       must send for the execution. Sending less gas will fail the tx at the cost of the relayer.
        ///                       Also protects against potential gas griefing attacks
        ///                       See https://ronan.eth.limo/blog/ethereum-gas-dangers/
        uint256 gas;
        ///
        /// @param gasPrice       Optional:
        ///                       Not implemented / used yet
        uint256 gasPrice;
        ///
        /// @param validAfter     Optional:
        ///                       the earliest block timestamp that the request can be forwarded in,
        ///                       or 0 if the request is not time-limited to occur after a certain time.
        ///                       Protects against relayers executing a certain transaction at an earlier moment
        ///                       not intended by the user, where it might have a completely different effect.
        uint256 validAfter;
        ///
        /// @param validUntil     Optional:
        ///                       Similar to EIP-2770: the latest block timestamp (instead of block number) the request
        ///                       can be forwarded, or 0 if request should be valid forever.
        ///                       Protects against relayers executing a certain transaction at a later moment
        ///                       not intended by the user, where it might have a completely different effect.
        uint256 validUntil;
        ///
        /// @param value          Optional:
        ///                       Not implemented / used yet (`msg.value` amount the broadcaster should send along)
        uint256 value;
    }

    /// @notice `castAuthorized()` input params
    struct CastAuthorizedParams {
        ///
        /// @param maxFee         Optional:
        ///                       the maximum Avocado charge-up allowed to be paid for tx execution
        uint256 maxFee;
        ///
        /// @param gasPrice       Optional:
        ///                       Not implemented / used yet
        uint256 gasPrice;
        ///
        /// @param validAfter     Optional:
        ///                       the earliest block timestamp that the request can be forwarded in,
        ///                       or 0 if the request is not time-limited to occur after a certain time.
        ///                       Protects against relayers executing a certain transaction at an earlier moment
        ///                       not intended by the user, where it might have a completely different effect.
        uint256 validAfter;
        ///
        /// @param validUntil     Optional:
        ///                       Similar to EIP-2770: the latest block timestamp (instead of block number) the request
        ///                       can be forwarded, or 0 if request should be valid forever.
        ///                       Protects against relayers executing a certain transaction at a later moment
        ///                       not intended by the user, where it might have a completely different effect.
        uint256 validUntil;
    }

    /// @notice params for `castChainAgnostic()` to be used when casting txs on multiple chains with one signature
    struct CastChainAgnosticParams {
        ///
        /// @param params cast params containing actions to be executed etc.
        CastParams params;
        ///
        /// @param forwardParams params related to forwarding validity
        CastForwardParams forwardParams;
        ///
        /// @param chainId chainId where these actions are valid
        uint256 chainId;
    }

    /// @notice unique chain agnostic hash with chain id to be used for chain agnostic interactions
    struct ChainAgnosticHash {
        ///
        /// @param hash EIP712 type `CAST_CHAIN_AGNOSTIC_PARAMS_TYPE_HASH` hash for one specific `CastChainAgnosticParams` struct
        bytes32 hash;
        ///
        /// @param chainId chainId where this `hash` is for
        uint256 chainId;
    }
}
