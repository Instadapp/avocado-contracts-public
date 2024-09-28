// SPDX-License-Identifier: MIT
pragma solidity >=0.8.17;

import { Address } from "@openzeppelin/contracts/utils/Address.sol";

import { IAvoFactory } from "../interfaces/IAvoFactory.sol";
import { IAvocadoMultisigV1 } from "../interfaces/IAvocadoMultisigV1.sol";

// empty interface used for Natspec docs for nice layout in automatically generated docs:
//
// @dev DEPRECATED. Superseded by direct simulation logic at Avocado Multisig with versions >= 1.1.0.
/// @title  AvoGasEstimationsHelper v1.0.1
/// @notice Helps to estimate gas costs for execution of arbitrary actions in an Avocado smart wallet,
/// especially when the smart wallet is not deployed yet.
interface AvoGasEstimationsHelper_V1 {}

interface IAvocadoMultisigWithCallTargets is IAvocadoMultisigV1 {
    function _callTargets(Action[] calldata actions_, uint256 id_) external payable;
}

abstract contract AvoGasEstimationsHelperEvents {
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
}

contract AvoGasEstimationsHelper is AvoGasEstimationsHelperEvents {
    using Address for address;

    error AvoGasEstimationsHelper__InvalidParams();
    error AvoGasEstimationsHelper__Unauthorized();

    /// @dev amount of gas to keep in cast caller method as reserve for emitting CastFailed / CastExecuted event.
    /// ~7500 gas + ~1400 gas + buffer. the dynamic part is covered with PER_SIGNER_RESERVE_GAS.
    uint256 internal constant CAST_EVENTS_RESERVE_GAS = 10_000;

    /***********************************|
    |           STATE VARIABLES         |
    |__________________________________*/

    /// @notice AvoFactory that this contract uses to find or create Avocado smart wallet deployments
    IAvoFactory public immutable avoFactory;

    /// @notice cached Avocado Bytecode to directly compute address in this contract to optimize gas usage.
    bytes32 public constant avocadoBytecode = 0x6b106ae0e3afae21508569f62d81c7d826b900a2e9ccc973ba97abfae026fc54;

    /// @notice constructor sets the immutable `avoFactory` address
    /// @param avoFactory_ address of AvoFactory (proxy)
    constructor(IAvoFactory avoFactory_) {
        if (address(avoFactory_) == address(0)) {
            revert AvoGasEstimationsHelper__InvalidParams();
        }
        avoFactory = avoFactory_;
    }

    struct SimulateResult {
        uint256 totalGasUsed;
        uint256 castGasUsed;
        uint256 deploymentGasUsed;
        bool isDeployed;
        bool success;
        string revertReason;
    }

    /// @notice                  Simulates `executeV1` from AvoForwarder, callable only by msg.sender = dead address
    ///                          (0x000000000000000000000000000000000000dEaD). Instead of calling `.cast()`, this method
    ///                          calls `._callTargets()` on the AvocadoMultisig.
    ///                          Helpful to estimate `CastForwardParams.gas` for an Avocado tx.
    ///                          For Avocado v1.
    ///                          Deploys the Avocado smart wallet if necessary.
    /// @dev  Expected use with `.estimateGas()`. User signed `CastForwardParams.gas` should be set to the estimated
    ///       amount minus gas used in AvoForwarder (until AvocadoMultisig logic where the gas param is validated).
    ///       Best to simulate first with a `.callstatic` to determine success / error and other return values.
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
    /// @return simulateResult_  result struct with following values:
    ///         - total amount of gas used
    ///         - amount of gas used for executing `_callTargets`
    ///         - amount of gas used for deployment (or for getting the contract if already deployed)
    ///         - boolean flag indicating if Avocado is already deployed
    ///         - boolean flag indicating whether executing actions reverts or not
    ///         - revert reason original error in default format "<action_index>_error"
    function simulateV1(
        address from_,
        uint32 index_,
        IAvocadoMultisigV1.CastParams calldata params_,
        IAvocadoMultisigV1.CastForwardParams calldata forwardParams_,
        IAvocadoMultisigV1.SignatureParams[] calldata signaturesParams_
    ) external payable returns (SimulateResult memory simulateResult_) {
        if (msg.sender != 0x000000000000000000000000000000000000dEaD) {
            revert AvoGasEstimationsHelper__Unauthorized();
        }

        uint256 gasSnapshotBefore_ = gasleft();
        // `_getDeployedAvocado()` automatically checks if Avocado has to be deployed
        // or if it already exists and simply returns the address in that case
        IAvocadoMultisigWithCallTargets avocadoMultisig_ = IAvocadoMultisigWithCallTargets(
            _getDeployedAvocado(from_, index_)
        );
        simulateResult_.deploymentGasUsed = gasSnapshotBefore_ - gasleft();

        simulateResult_.isDeployed = simulateResult_.deploymentGasUsed < 100_000; // avocado for sure not yet deployed if gas used > 100k
        // (deployment costs > 200k)

        bytes memory result_;
        {
            uint256 gasSnapshotBeforeCast_ = gasleft();

            (simulateResult_.success, result_) = address(avocadoMultisig_).call{ value: forwardParams_.value }(
                abi.encodeCall(avocadoMultisig_._callTargets, (params_.actions, params_.id))
            );

            simulateResult_.castGasUsed = gasSnapshotBeforeCast_ - gasleft();
        }

        if (!simulateResult_.success) {
            if (result_.length == 0) {
                // out of gas check with gasleft() not added here as it might cause issues with .estimateGas

                // @dev this case might be caused by edge-case out of gas errors that we were unable to catch,
                // but could potentially also have other reasons
                simulateResult_.revertReason = "AVO__REASON_NOT_DEFINED";
            } else {
                assembly {
                    result_ := add(result_, 0x04)
                }
                simulateResult_.revertReason = abi.decode(result_, (string));
            }
        }

        if (simulateResult_.success) {
            emit Executed(from_, index_, address(avocadoMultisig_), params_.source, params_.metadata);
        } else {
            emit ExecuteFailed(
                from_,
                index_,
                address(avocadoMultisig_),
                params_.source,
                params_.metadata,
                simulateResult_.revertReason
            );
        }

        simulateResult_.totalGasUsed = gasSnapshotBefore_ - gasleft();
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
}
