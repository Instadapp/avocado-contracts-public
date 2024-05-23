// SPDX-License-Identifier: MIT
pragma solidity >=0.8.18;

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { Address } from "@openzeppelin/contracts/utils/Address.sol";

import { IAvoFactory } from "./interfaces/IAvoFactory.sol";
import { IAvoRegistry, IAvoFeeCollector } from "./interfaces/IAvoRegistry.sol";

// empty interface used for Natspec docs for nice layout in automatically generated docs:
//
/// @title  AvoRegistry v1.1.0
/// @notice Registry for various config data and general actions for Avocado contracts:
/// - holds lists of valid versions for Avocado & AvoForwarder
/// - handles fees for `castAuthorized()` calls
///
/// Upgradeable through AvoRegistryProxy
interface AvoRegistry_V1 {}

abstract contract AvoRegistryConstants is IAvoRegistry {
    /// @notice AvoFactory where new versions get registered automatically as default version on `registerAvoVersion()`
    IAvoFactory public immutable avoFactory;

    /// @dev maximum fee possible when mode is percentage (mode = 0)
    uint256 internal constant MAX_PERCENTAGE_FEE = 1e9; // 1_000% (top-up fee can be more than 100%)

    constructor(IAvoFactory avoFactory_) {
        avoFactory = avoFactory_;
    }
}

abstract contract AvoRegistryVariables is IAvoRegistry, Initializable, OwnableUpgradeable {
    // @dev variables here start at storage slot 101, before is:
    // - Initializable with storage slot 0:
    // uint8 private _initialized;
    // bool private _initializing;
    // - OwnableUpgradeable with slots 1 to 100:
    // uint256[50] private __gap; (from ContextUpgradeable, slot 1 until slot 50)
    // address private _owner; (at slot 51)
    // uint256[49] private __gap; (slot 52 until slot 100)

    // ---------------- slot 101 -----------------

    /// @notice fee config for `calcFee()`. Configurable by owner.
    FeeConfig public feeConfig;

    // ---------------- slot 102 -----------------

    /// @notice mapping to store allowed Avocado versions. Modifiable by owner.
    mapping(address => bool) public avoVersions;

    // ---------------- slot 103 -----------------

    /// @notice mapping to store allowed AvoForwarder versions. Modifiable by owner.
    mapping(address => bool) public avoForwarderVersions;
}

abstract contract AvoRegistryErrors {
    /// @notice thrown for `requireVersion()` methods
    error AvoRegistry__InvalidVersion();

    /// @notice thrown when a requested fee mode is not implemented
    error AvoRegistry__FeeModeNotImplemented(uint8 mode);

    /// @notice thrown when a method is called with invalid params, e.g. the zero address
    error AvoRegistry__InvalidParams();

    /// @notice thrown when an unsupported method is called (e.g. renounceOwnership)
    error AvoRegistry__Unsupported();
}

abstract contract AvoRegistryEvents is IAvoRegistry {
    /// @notice emitted when the status for a certain AvoMultsig version is updated
    event SetAvoVersion(address indexed avoVersion, bool indexed allowed, bool indexed setDefault);

    /// @notice emitted when the status for a certain AvoForwarder version is updated
    event SetAvoForwarderVersion(address indexed avoForwarderVersion, bool indexed allowed);

    /// @notice emitted when the fee config is updated
    event FeeConfigUpdated(address indexed feeCollector, uint8 indexed mode, uint88 indexed fee);
}

abstract contract AvoRegistryCore is AvoRegistryConstants, AvoRegistryVariables, AvoRegistryErrors, AvoRegistryEvents {
    /***********************************|
    |              MODIFIERS            |
    |__________________________________*/

    /// @dev checks if an address is not the zero address
    modifier validAddress(address _address) {
        if (_address == address(0)) {
            revert AvoRegistry__InvalidParams();
        }
        _;
    }

    modifier isContract(address _address) {
        if (!Address.isContract(_address)) {
            revert AvoRegistry__InvalidParams();
        }
        _;
    }

    /***********************************|
    |    CONSTRUCTOR / INITIALIZERS     |
    |__________________________________*/

    constructor(IAvoFactory avoFactory_) validAddress(address(avoFactory_)) AvoRegistryConstants(avoFactory_) {
        // ensure logic contract initializer is not abused by disabling initializing
        // see https://forum.openzeppelin.com/t/security-advisory-initialize-uups-implementation-contracts/15301
        // and https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#initializing_the_implementation_contract
        _disableInitializers();
    }
}

abstract contract AvoFeeCollector is AvoRegistryCore {
    /// @inheritdoc IAvoFeeCollector
    function calcFee(uint256 gasUsed_) public view returns (uint256 feeAmount_, address payable feeCollector_) {
        FeeConfig memory feeConfig_ = feeConfig;

        if (feeConfig_.fee > 0) {
            if (feeConfig_.mode == 0) {
                // percentage of `gasUsed_` fee amount mode
                if (gasUsed_ == 0) {
                    revert AvoRegistry__InvalidParams();
                }

                // fee amount = gasUsed * gasPrice * fee percentage. (tx.gasprice is in wei)
                feeAmount_ = (gasUsed_ * tx.gasprice * feeConfig_.fee) / 1e8; // 1e8 = 100%
            } else if (feeConfig_.mode == 1) {
                // absolute fee amount mode
                feeAmount_ = feeConfig_.fee;
            } else {
                // theoretically not reachable because of check in `updateFeeConfig` but doesn't hurt to have this here
                revert AvoRegistry__FeeModeNotImplemented(feeConfig_.mode);
            }
        }

        return (feeAmount_, feeConfig_.feeCollector);
    }

    /***********************************|
    |            ONLY OWNER             |
    |__________________________________*/

    /// @notice sets `feeConfig_` as the new fee config in storage. Only callable by owner.
    function updateFeeConfig(FeeConfig calldata feeConfig_) external onlyOwner validAddress(feeConfig_.feeCollector) {
        if (feeConfig_.mode > 1) {
            revert AvoRegistry__FeeModeNotImplemented(feeConfig_.mode);
        }
        if (feeConfig_.mode == 0 && feeConfig_.fee > MAX_PERCENTAGE_FEE) {
            // in percentage mode, fee can not be more than MAX_PERCENTAGE_FEE
            revert AvoRegistry__InvalidParams();
        }

        feeConfig = feeConfig_;

        emit FeeConfigUpdated(feeConfig_.feeCollector, feeConfig_.mode, feeConfig_.fee);
    }
}

contract AvoRegistry is AvoRegistryCore, AvoFeeCollector {
    /***********************************|
    |    CONSTRUCTOR / INITIALIZERS     |
    |__________________________________*/

    constructor(IAvoFactory avoFactory_) AvoRegistryCore(avoFactory_) {}

    /// @notice initializes the contract with `owner_` as owner
    function initialize(address owner_) public initializer validAddress(owner_) {
        _transferOwnership(owner_);
    }

    /***********************************|
    |            PUBLIC API             |
    |__________________________________*/

    /// @inheritdoc IAvoRegistry
    function requireValidAvoVersion(address avoVersion_) external view {
        if (!avoVersions[avoVersion_]) {
            revert AvoRegistry__InvalidVersion();
        }
    }

    /// @inheritdoc IAvoRegistry
    function requireValidAvoForwarderVersion(address avoForwarderVersion_) external view {
        if (!avoForwarderVersions[avoForwarderVersion_]) {
            revert AvoRegistry__InvalidVersion();
        }
    }

    /***********************************|
    |            ONLY OWNER             |
    |__________________________________*/

    /// @notice              sets the status for a certain address as allowed AvoForwarder version.
    ///                      Only callable by owner.
    /// @param avoForwarder_ the address of the contract to treat as AvoForwarder version
    /// @param allowed_      flag to set this address as valid version (true) or not (false)
    function setAvoForwarderVersion(
        address avoForwarder_,
        bool allowed_
    ) external onlyOwner validAddress(avoForwarder_) isContract(avoForwarder_) {
        avoForwarderVersions[avoForwarder_] = allowed_;

        emit SetAvoForwarderVersion(avoForwarder_, allowed_);
    }

    /// @notice             sets the status for a certain address as allowed / default Avocado version.
    ///                     Only callable by owner.
    /// @param avoVersion_  the address of the contract to treat as Avocado version
    /// @param allowed_     flag to set this address as valid version (true) or not (false)
    /// @param setDefault_  flag to indicate whether this version should automatically be set as new
    ///                     default version for new deployments at the linked `avoFactory`
    function setAvoVersion(
        address avoVersion_,
        bool allowed_,
        bool setDefault_
    ) external onlyOwner validAddress(avoVersion_) isContract(avoVersion_) {
        if (!allowed_ && setDefault_) {
            // can't be not allowed but supposed to be set as default
            revert AvoRegistry__InvalidParams();
        }

        avoVersions[avoVersion_] = allowed_;

        if (setDefault_) {
            // register the new version as default version at the linked AvoFactory
            avoFactory.setAvoImpl(avoVersion_);
        }

        emit SetAvoVersion(avoVersion_, allowed_, setDefault_);
    }

    /// @notice override renounce ownership as it could leave the contract in an unwanted state if called by mistake.
    function renounceOwnership() public view override onlyOwner {
        revert AvoRegistry__Unsupported();
    }
}
