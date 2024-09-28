// SPDX-License-Identifier: MIT
pragma solidity >=0.8.18;

import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import { IAvocado } from "./Avocado.sol";
import { IAvocadoMultisigV1 } from "./interfaces/IAvocadoMultisigV1.sol";
import { IAvoRegistry } from "./interfaces/IAvoRegistry.sol";
import { IAvoFactory } from "./interfaces/IAvoFactory.sol";
import { IAvoForwarder } from "./interfaces/IAvoForwarder.sol";

// --------------------------- DEVELOPER NOTES -----------------------------------------
// @dev To deploy a new version of Avocado (proxy), the new factory contract must be deployed
// and AvoFactoryProxy upgraded to that new contract (to update the cached bytecode).
// -------------------------------------------------------------------------------------

// empty interface used for Natspec docs for nice layout in automatically generated docs:
//
/// @title  AvoFactory v1.1.0
/// @notice Deploys Avocado smart wallet contracts at deterministic addresses using Create2.
///
/// Upgradeable through AvoFactoryProxy
interface AvoFactory_V1 {}

abstract contract AvoFactoryErrors {
    /// @notice thrown when trying to deploy an Avocado for a smart contract as owner
    error AvoFactory__NotEOA();

    /// @notice thrown when a caller is not authorized to execute a certain action
    error AvoFactory__Unauthorized();

    /// @notice thrown when a method is called with invalid params (e.g. zero address)
    error AvoFactory__InvalidParams();

    /// @notice thrown when deploy is called with an index where index-1 is not deployed yet.
    ///         After index > 5, index must be used sequential.
    error AvoFactory__IndexNonSequential();

    /// @notice thrown when deploy methods are called before an implementation is defined
    error AvoFactory__ImplementationNotDefined();
}

abstract contract AvoFactoryConstants is AvoFactoryErrors, IAvoFactory {
    /// @notice hardcoded Avocado creation code.
    //
    // Avocado (proxy) should never change because it influences the deterministic address
    bytes public constant avocadoCreationCode =
        hex"60a060405234801561001057600080fd5b5060408051808201825260048152638c65738960e01b60208201529051600091339161003c91906100b2565b600060405180830381855afa9150503d8060008114610077576040519150601f19603f3d011682016040523d82523d6000602084013e61007c565b606091505b506020810151604090910151608052600080546001600160a01b0319166001600160a01b03909216919091179055506100e19050565b6000825160005b818110156100d357602081860181015185830152016100b9565b506000920191825250919050565b6080516101476100fb6000396000600601526101476000f3fe60806040527f00000000000000000000000000000000000000000000000000000000000000006000357f4d42058500000000000000000000000000000000000000000000000000000000810161006f5773ffffffffffffffffffffffffffffffffffffffff821660005260206000f35b7f68beab3f0000000000000000000000000000000000000000000000000000000081036100a0578160005260206000f35b73ffffffffffffffffffffffffffffffffffffffff600054167f874095c60000000000000000000000000000000000000000000000000000000082036100ea578060005260206000f35b3660008037600080366000845af49150503d6000803e80801561010c573d6000f35b3d6000fdfea2646970667358221220bf171834b0948ebffd196d6a4208dbd5d0a71f76dfac9d90499de318c59558fc64736f6c63430008120033";

    /// @notice cached avocado (proxy) bytecode hash to optimize gas usage
    bytes32 public constant avocadoBytecode = keccak256(abi.encodePacked(avocadoCreationCode));

    /// @notice  registry holding the valid versions (addresses) for Avocado smart wallet implementation contracts.
    ///          The registry is used to verify a valid version before setting a new `avoImpl`
    ///          as default for new deployments.
    IAvoRegistry public immutable avoRegistry;

    /// @dev maximum count of avocado wallets that can be created non continuously
    uint256 internal constant _MAX_NON_CONTINUOUS_AVOCADOS = 20;

    constructor(IAvoRegistry avoRegistry_) {
        avoRegistry = avoRegistry_;

        // check hardcoded avocadoBytecode matches expected value
        if (avocadoBytecode != 0x6b106ae0e3afae21508569f62d81c7d826b900a2e9ccc973ba97abfae026fc54) {
            revert AvoFactory__InvalidParams();
        }
    }
}

abstract contract AvoFactoryVariables is AvoFactoryConstants, Initializable {
    // @dev Before variables here are vars from Initializable:
    // uint8 private _initialized;
    // bool private _initializing;

    /// @notice Avocado logic contract address that new Avocado deployments point to.
    ///         Modifiable only by `avoRegistry`.
    address public avoImpl;

    // 10 bytes empty

    // ----------------------- slot 1 to 101 ---------------------------

    // create some storage slot gaps because variables below will be replaced with transient storage vars after
    // EIP-1153 becomes available.
    uint256[101] private __gaps;

    // ----------------------- slot 102 ----------------------------

    /// @dev owner of Avocado that is currently being deployed.
    // set before deploying proxy, to return in callback `transientDeployData()`
    address internal _transientDeployOwner;

    /// @dev index of Avocado that is currently being deployed.
    // set before deploying proxy, to return in callback `transientDeployData()`
    uint32 internal _transientDeployIndex;

    // 8 bytes empty

    // ----------------------- slot 103 ----------------------------
    /// @dev version address Avocado that is currently being deployed.
    // set before deploying proxy, to return in callback `transientDeployData()`
    address internal _transientDeployVersion;

    // 12 bytes empty

    /// @dev resets transient storage to default value (1). 1 is better than 0 for optimizing gas refunds
    /// because total refund amount is capped to 20% of tx gas cost (EIP-3529).
    function _resetTransientStorage() internal {
        assembly {
            // Store 1 in the transient storage slots 102 & 103
            sstore(102, 1)
            sstore(103, 1)
        }
    }
}

abstract contract AvoFactoryEvents {
    /// @notice Emitted when a new Avocado has been deployed
    event AvocadoDeployed(address indexed owner, uint32 indexed index, uint16 avoType, address indexed avocado);

    /// @notice Emitted when a new Avocado has been deployed with a non-default version
    event AvocadoDeployedWithVersion(
        address indexed owner,
        uint32 index,
        uint16 avoType,
        address indexed avocado,
        address indexed version
    );
}

abstract contract AvoFactoryCore is AvoFactoryErrors, AvoFactoryConstants, AvoFactoryVariables, AvoFactoryEvents {
    constructor(IAvoRegistry avoRegistry_) AvoFactoryConstants(avoRegistry_) {
        if (address(avoRegistry_) == address(0)) {
            revert AvoFactory__InvalidParams();
        }

        // Ensure logic contract initializer is not abused by disabling initializing
        // see https://forum.openzeppelin.com/t/security-advisory-initialize-uups-implementation-contracts/15301
        // and https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#initializing_the_implementation_contract
        _disableInitializers();
    }

    /***********************************|
    |              INTERNAL             |
    |__________________________________*/

    /// @dev            gets the salt used for deterministic deployment for `owner_` and `index_`
    /// @return         the bytes32 (keccak256) salt
    function _getSalt(address owner_, uint32 index_) internal pure returns (bytes32) {
        // use owner + index of wallet nr per EOA (plus "type", currently always 0)
        // Note CREATE2 deployments take into account the deployers address (i.e. this factory address)
        return keccak256(abi.encode(owner_, index_, 0));
    }
}

contract AvoFactory is AvoFactoryCore {
    /***********************************|
    |              MODIFIERS            |
    |__________________________________*/

    /// @dev reverts if `owner_` is a contract
    modifier onlyEOA(address owner_) {
        if (owner_ == address(0) || Address.isContract(owner_)) {
            revert AvoFactory__NotEOA();
        }
        _;
    }

    /// @dev reverts if `msg.sender` is not `avoRegistry`
    modifier onlyRegistry() {
        if (msg.sender != address(avoRegistry)) {
            revert AvoFactory__Unauthorized();
        }
        _;
    }

    /***********************************|
    |    CONSTRUCTOR / INITIALIZERS     |
    |__________________________________*/

    /// @notice constructor sets the immutable `avoRegistry` address
    constructor(IAvoRegistry avoRegistry_) AvoFactoryCore(avoRegistry_) {}

    /// @notice initializes the contract
    function initialize() public initializer {
        _resetTransientStorage();
    }

    /***********************************|
    |            PUBLIC API             |
    |__________________________________*/

    /// @inheritdoc IAvoFactory
    function isAvocado(address avoSmartWallet_) external view returns (bool) {
        if (avoSmartWallet_ == address(0) || !Address.isContract(avoSmartWallet_)) {
            // can not recognize isAvocado when not yet deployed
            return false;
        }

        // get the owner from the Avocado smart wallet
        try IAvocado(avoSmartWallet_)._data() returns (uint256 data_) {
            address owner_;
            uint32 index_;

            // cast last 20 bytes of hash to owner address and 2 bytes before to index via low level assembly
            assembly {
                owner_ := and(data_, 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF)
                index_ := and(shr(160, data_), 0xFFFFFFFF) // shift right and mask to read index
            }

            // compute the Avocado address for that owner & index and check it against given address. if it
            // matches it guarantees the address is an Avocado deployed by this AvoFactory because factory
            // address is part of deterministic address computation
            if (computeAvocado(owner_, index_) == avoSmartWallet_) {
                return true;
            }
        } catch {
            // if fetching data_ (owner & index) doesn't work, can not determine if it's an Avocado smart wallet
            return false;
        }

        return false;
    }

    /// @inheritdoc IAvoFactory
    function deploy(address owner_, uint32 index_) external onlyEOA(owner_) returns (address deployedAvocado_) {
        _transientDeployVersion = avoImpl;
        if (_transientDeployVersion == address(0)) {
            revert AvoFactory__ImplementationNotDefined();
        }
        // check that a smart wallet at index -1 already exists (if > 0) to guarantee sequential use (easier to iterate)
        if (index_ > _MAX_NON_CONTINUOUS_AVOCADOS && !Address.isContract(computeAvocado(owner_, index_ - 1))) {
            revert AvoFactory__IndexNonSequential();
        }

        _transientDeployOwner = owner_;
        _transientDeployIndex = index_;

        // deploy Avocado deterministically using low level CREATE2 opcode to use hardcoded Avocado bytecode
        bytes32 salt_ = _getSalt(owner_, index_);
        bytes memory byteCode_ = avocadoCreationCode;
        assembly {
            deployedAvocado_ := create2(0, add(byteCode_, 0x20), mload(byteCode_), salt_)
        }

        _resetTransientStorage();

        // initialize AvocadoMultisig through proxy with IAvocadoMultisig interface.
        // if version or owner would not be correctly set at the deployed contract, this would revert.
        IAvocadoMultisigV1(deployedAvocado_).initialize();

        emit AvocadoDeployed(owner_, index_, 0, deployedAvocado_);
    }

    /// @inheritdoc IAvoFactory
    function deployWithVersion(
        address owner_,
        uint32 index_,
        address avoVersion_
    ) external onlyEOA(owner_) returns (address deployedAvocado_) {
        avoRegistry.requireValidAvoVersion(avoVersion_);

        // check that a smart wallet at index -1 already exists (if > 0) to guarantee sequential use (easier to iterate)
        if (index_ > _MAX_NON_CONTINUOUS_AVOCADOS && !Address.isContract(computeAvocado(owner_, index_ - 1))) {
            revert AvoFactory__InvalidParams();
        }

        _transientDeployOwner = owner_;
        _transientDeployIndex = index_;
        _transientDeployVersion = avoVersion_;

        // deploy Avocado deterministically using low level CREATE2 opcode to use hardcoded Avocado bytecode
        bytes32 salt_ = _getSalt(owner_, index_);
        bytes memory byteCode_ = avocadoCreationCode;
        assembly {
            deployedAvocado_ := create2(0, add(byteCode_, 0x20), mload(byteCode_), salt_)
        }

        _resetTransientStorage();

        // initialize AvocadoMultisig through proxy with IAvocadoMultisig interface.
        // if version or owner would not be correctly set at the deployed contract, this would revert.
        IAvocadoMultisigV1(deployedAvocado_).initialize();

        emit AvocadoDeployedWithVersion(owner_, index_, 0, deployedAvocado_, avoVersion_);
    }

    /// @inheritdoc IAvoFactory
    function computeAvocado(address owner_, uint32 index_) public view returns (address computedAddress_) {
        if (Address.isContract(owner_)) {
            // owner of a Avocado must be an EOA, if it's a contract return zero address
            return address(0);
        }

        // replicate Create2 address determination logic
        bytes32 hash = keccak256(
            abi.encodePacked(bytes1(0xff), address(this), _getSalt(owner_, index_), avocadoBytecode)
        );

        // cast last 20 bytes of hash to address via low level assembly
        assembly {
            computedAddress_ := and(hash, 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF)
        }
    }

    /// @notice returns transient data used to pass variables into the Avocado proxy during deployment.
    /// Reduces gas cost and dependency of deterministic address on constructor args.
    function transientDeployData() external view returns (address version_, uint256 data_) {
        data_ =
            /* (uint256(0) << 192) | type currently not used, always 0 */
            (uint256(_transientDeployIndex) << 160) |
            uint256(uint160(_transientDeployOwner));
        return (_transientDeployVersion, data_);
    }

    /***********************************|
    |            ONLY  REGISTRY         |
    |__________________________________*/

    /// @inheritdoc IAvoFactory
    function setAvoImpl(address avoImpl_) external onlyRegistry {
        // do not `registry.requireValidAvoVersion()` because sender is registry anyway
        avoImpl = avoImpl_;
    }
}
