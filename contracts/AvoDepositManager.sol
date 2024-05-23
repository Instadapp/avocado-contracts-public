// SPDX-License-Identifier: MIT
pragma solidity >=0.8.18;

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { PausableUpgradeable } from "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { IAvoFactory } from "./interfaces/IAvoFactory.sol";
import { IAvoConfigV1 } from "./interfaces/IAvoConfigV1.sol";

// empty interface used for Natspec docs for nice layout in automatically generated docs:
//
/// @title    AvoDepositManager v1.1.0
/// @notice   Handles deposits in a deposit token (e.g. USDC).
/// Note: user balances are tracked off-chain through events by the Avocado infrastructure.
///
/// Upgradeable through AvoDepositManagerProxy
interface AvoDepositManager_V1 {}

abstract contract AvoDepositManagerErrors {
    /// @notice thrown when `msg.sender` is not authorized to access requested functionality
    error AvoDepositManager__Unauthorized();

    /// @notice thrown when invalid params for a method are submitted, e.g. zero address as input param
    error AvoDepositManager__InvalidParams();

    /// @notice thrown when a withdraw request already exists
    error AvoDepositManager__RequestAlreadyExist();

    /// @notice thrown when a withdraw request does not exist
    error AvoDepositManager__RequestNotExist();

    /// @notice thrown when a withdraw request does not at least request `minWithdrawAmount`
    error AvoDepositManager__MinWithdraw();

    /// @notice thrown when a withdraw request amount does not cover the withdraw fee at processing time
    error AvoDepositManager__FeeNotCovered();

    /// @notice thrown when an unsupported method is called (e.g. renounceOwnership)
    error AvoDepositManager__Unsupported();
}

abstract contract AvoDepositManagerConstants is AvoDepositManagerErrors {
    /// @notice address of the deposit token (USDC)
    IERC20 public immutable depositToken;

    /// @notice address of the AvoFactory (proxy)
    IAvoFactory public immutable avoFactory;

    constructor(IAvoFactory avoFactory_, IAvoConfigV1 avoConfigV1_) {
        avoFactory = avoFactory_;

        // get depositToken from AvoConfigV1 contract
        IAvoConfigV1.AvoDepositManagerConfig memory avoConfig_ = avoConfigV1_.avoDepositManagerConfig();

        if (avoConfig_.depositToken == address(0)) {
            revert AvoDepositManager__InvalidParams();
        }
        depositToken = IERC20(avoConfig_.depositToken);
    }
}

abstract contract AvoDepositManagerStructs {
    /// @notice struct to represent a withdrawal request in storage mapping
    struct WithdrawRequest {
        address to;
        uint256 amount;
    }
}

abstract contract AvoDepositManagerVariables is
    Initializable,
    PausableUpgradeable,
    OwnableUpgradeable,
    AvoDepositManagerStructs,
    AvoDepositManagerConstants
{
    // @dev variables here start at storage slot 151, before is:
    // - Initializable with storage slot 0:
    // uint8 private _initialized;
    // bool private _initializing;
    // - PausableUpgradeable with slots 1 to 100:
    // uint256[50] private __gap; (from ContextUpgradeable, slot 1 until slot 50)
    // bool private _paused; (at slot 51)
    // uint256[49] private __gap; (slot 52 until slot 100)
    // - OwnableUpgradeable with slots 100 to 150:
    // address private _owner; (at slot 101)
    // uint256[49] private __gap; (slot 102 until slot 150)

    // ---------------- slot 151 -----------------

    /// @notice address to which funds can be systemWithdrawn to. Configurable by owner.
    address public systemWithdrawAddress;

    /// @notice minimum amount which must stay in contract and can not be systemWithdrawn. Configurable by owner.
    uint96 public systemWithdrawLimit;

    // ---------------- slot 152 -----------------

    /// @notice static withdraw fee charged when a withdrawRequest is processed. Configurable by owner.
    uint96 public withdrawFee;

    /// @notice minimum withdraw amount that a user must request to withdraw. Configurable by owner.
    uint96 public minWithdrawAmount;

    // 8 bytes empty

    // ---------------- slot 153 -----------------

    /// @notice allowed auths list (1 = allowed) that can confirm withdraw requests. Configurable by owner.
    mapping(address => uint256) public auths;

    // ---------------- slot 154 -----------------

    /// @notice withdraw requests. unique id -> WithdrawRequest (amount and receiver)
    mapping(bytes32 => WithdrawRequest) public withdrawRequests;
}

abstract contract AvoDepositManagerEvents {
    /// @notice emitted when a deposit occurs through `depositOnBehalf()`
    event Deposit(address indexed sender, address indexed avocado, uint256 indexed amount);

    /// @notice emitted when a user requests a withdrawal
    event WithdrawRequested(bytes32 indexed id, address indexed avocado, uint256 indexed amount);

    /// @notice emitted when a withdraw request is executed
    event WithdrawProcessed(bytes32 indexed id, address indexed user, uint256 indexed amount, uint256 fee);

    /// @notice emitted when a withdraw request is removed
    event WithdrawRemoved(bytes32 indexed id);

    /// @notice emitted when someone requests a source withdrawal
    event SourceWithdrawRequested(bytes32 indexed id, address indexed user, uint256 indexed amount);

    /// @notice emitted when someone requests a referral withdrawal
    event ReferralWithdrawRequested(bytes32 indexed id, address indexed user, uint256 indexed amount);

    // ------------------------ Settings events ------------------------
    /// @notice emitted when the withdrawLimit is modified by owner
    event SetSystemWithdrawLimit(uint96 indexed systemWithdrawLimit);
    /// @notice emitted when the withdrawAddress is modified by owner
    event SetSystemWithdrawAddress(address indexed systemWithdrawAddress);
    /// @notice emitted when the withdrawFee is modified by owner
    event SetWithdrawFee(uint96 indexed withdrawFee);
    /// @notice emitted when the minWithdrawAmount is modified by owner
    event SetMinWithdrawAmount(uint96 indexed minWithdrawAmount);
    /// @notice emitted when the auths are modified by owner
    event SetAuth(address indexed auth, bool indexed allowed);
}

abstract contract AvoDepositManagerCore is
    AvoDepositManagerErrors,
    AvoDepositManagerConstants,
    AvoDepositManagerVariables,
    AvoDepositManagerEvents
{
    /***********************************|
    |              MODIFIERS            |
    |__________________________________*/

    /// @dev checks if an address is not the zero address
    modifier validAddress(address address_) {
        if (address_ == address(0)) {
            revert AvoDepositManager__InvalidParams();
        }
        _;
    }

    /// @dev checks if `msg.sender` is an allowed auth
    modifier onlyAuths() {
        // @dev using inverted positive case to save gas
        if (!(auths[msg.sender] == 1 || msg.sender == owner())) {
            revert AvoDepositManager__Unauthorized();
        }
        _;
    }

    /// @dev checks if `address_` is an Avocado smart wallet (through the AvoFactory)
    modifier onlyAvocado(address address_) {
        if (!avoFactory.isAvocado(address_)) {
            revert AvoDepositManager__Unauthorized();
        }
        _;
    }

    /***********************************|
    |    CONSTRUCTOR / INITIALIZERS     |
    |__________________________________*/

    constructor(
        IAvoFactory avoFactory_,
        IAvoConfigV1 avoConfigV1_
    ) validAddress(address(avoFactory_)) AvoDepositManagerConstants(avoFactory_, avoConfigV1_) {
        // ensure logic contract initializer is not abused by disabling initializing
        // see https://forum.openzeppelin.com/t/security-advisory-initialize-uups-implementation-contracts/15301
        // and https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#initializing_the_implementation_contract
        _disableInitializers();
    }

    /***********************************|
    |               INTERNAL            |
    |__________________________________*/

    /// @dev handles a withdraw request for `amount_` for `msg.sender`, giving it a `uniqueId_` and storing it
    function _handleRequestWithdraw(uint256 amount_) internal returns (bytes32 uniqueId_) {
        if (amount_ < minWithdrawAmount || amount_ == 0) {
            revert AvoDepositManager__MinWithdraw();
        }

        // get a unique id based on block timestamp, sender and amount
        uniqueId_ = keccak256(abi.encode(block.timestamp, msg.sender, amount_));

        if (withdrawRequests[uniqueId_].amount > 0) {
            revert AvoDepositManager__RequestAlreadyExist();
        }

        withdrawRequests[uniqueId_] = WithdrawRequest(msg.sender, amount_);
    }
}

abstract contract AvoDepositManagerOwnerActions is AvoDepositManagerCore {
    /// @notice                       Sets new system withdraw limit. Only callable by owner.
    /// @param systemWithdrawLimit_   new value
    function setSystemWithdrawLimit(uint96 systemWithdrawLimit_) external onlyOwner {
        systemWithdrawLimit = systemWithdrawLimit_;
        emit SetSystemWithdrawLimit(systemWithdrawLimit_);
    }

    /// @notice                         Sets new system withdraw address. Only callable by owner.
    /// @param systemWithdrawAddress_   new value
    function setSystemWithdrawAddress(
        address systemWithdrawAddress_
    ) external onlyOwner validAddress(systemWithdrawAddress_) {
        systemWithdrawAddress = systemWithdrawAddress_;
        emit SetSystemWithdrawAddress(systemWithdrawAddress_);
    }

    /// @notice                 Sets new withdraw fee (in absolute amount). Only callable by owner.
    /// @param withdrawFee_     new value
    function setWithdrawFee(uint96 withdrawFee_) external onlyOwner {
        // minWithdrawAmount must cover the withdrawFee at all times
        if (minWithdrawAmount < withdrawFee_) {
            revert AvoDepositManager__InvalidParams();
        }
        withdrawFee = withdrawFee_;
        emit SetWithdrawFee(withdrawFee_);
    }

    /// @notice                     Sets new min withdraw amount. Only callable by owner.
    /// @param minWithdrawAmount_   new value
    function setMinWithdrawAmount(uint96 minWithdrawAmount_) external onlyOwner {
        // minWithdrawAmount must cover the withdrawFee at all times
        if (minWithdrawAmount_ < withdrawFee) {
            revert AvoDepositManager__InvalidParams();
        }
        minWithdrawAmount = minWithdrawAmount_;
        emit SetMinWithdrawAmount(minWithdrawAmount_);
    }

    /// @notice                   Sets an address as allowed auth or not. Only callable by owner.
    /// @param auth_              address to set auth value for
    /// @param allowed_           bool flag for whether address is allowed as auth or not
    function setAuth(address auth_, bool allowed_) external onlyOwner validAddress(auth_) {
        auths[auth_] = allowed_ ? 1 : 0;
        emit SetAuth(auth_, allowed_);
    }

    /// @notice unpauses the contract, re-enabling withdraw requests and processing. Only callable by owner.
    function unpause() external onlyOwner {
        _unpause();
    }
}

abstract contract AvoDepositManagerAuthsActions is AvoDepositManagerCore {
    using SafeERC20 for IERC20;

    /// @notice             Authorizes and processes a withdraw request. Only callable by auths & owner.
    /// @param withdrawId_  unique withdraw request id as created in `requestWithdraw()`
    function processWithdraw(bytes32 withdrawId_) external onlyAuths whenNotPaused {
        WithdrawRequest memory withdrawRequest_ = withdrawRequests[withdrawId_];

        if (withdrawRequest_.amount == 0) {
            revert AvoDepositManager__RequestNotExist();
        }

        uint256 withdrawFee_ = withdrawFee;

        if (withdrawRequest_.amount < withdrawFee_) {
            // withdrawRequest_.amount could be < withdrawFee if config value was modified after request was created
            revert AvoDepositManager__FeeNotCovered();
        }

        uint256 withdrawAmount_;
        unchecked {
            // because of if statement above we know this can not underflow
            withdrawAmount_ = withdrawRequest_.amount - withdrawFee_;
        }
        delete withdrawRequests[withdrawId_];

        depositToken.safeTransfer(withdrawRequest_.to, withdrawAmount_);

        emit WithdrawProcessed(withdrawId_, withdrawRequest_.to, withdrawAmount_, withdrawFee_);
    }

    /// @notice pauses the contract, temporarily blocking withdraw requests and processing.
    ///         Only callable by auths & owner. Unpausing can only be triggered by owner.
    function pause() external onlyAuths {
        _pause();
    }

    /// @notice Withdraws balance of deposit token down to `systemWithdrawLimit` to the configured `systemWithdrawAddress`
    function systemWithdraw() external onlyAuths {
        uint256 withdrawLimit_ = systemWithdrawLimit;

        uint256 balance_ = depositToken.balanceOf(address(this));
        if (balance_ > withdrawLimit_) {
            uint256 withdrawAmount_;
            unchecked {
                // can not underflow because of if statement just above
                withdrawAmount_ = balance_ - withdrawLimit_;
            }

            depositToken.safeTransfer(systemWithdrawAddress, withdrawAmount_);
        }
    }
}

contract AvoDepositManager is AvoDepositManagerCore, AvoDepositManagerOwnerActions, AvoDepositManagerAuthsActions {
    using SafeERC20 for IERC20;

    /***********************************|
    |    CONSTRUCTOR / INITIALIZERS     |
    |__________________________________*/

    constructor(
        IAvoFactory avoFactory_,
        IAvoConfigV1 avoConfigV1_
    ) validAddress(address(avoFactory_)) AvoDepositManagerCore(avoFactory_, avoConfigV1_) {}

    /// @notice         initializes the contract for `owner_` as owner, and various config values regarding withdrawals.
    ///                 Starts the contract in paused state.
    /// @param owner_                    address of owner authorized to withdraw funds and set config values, auths etc.
    /// @param systemWithdrawAddress_    address to which funds can be system withdrawn to
    /// @param systemWithdrawLimit_      minimum amount which must stay in contract and can not be system withdrawn
    /// @param minWithdrawAmount_        static withdraw fee charged when a withdrawRequest is processed
    /// @param withdrawFee_              minimum withdraw amount that a user must request to withdraw
    function initialize(
        address owner_,
        address systemWithdrawAddress_,
        uint96 systemWithdrawLimit_,
        uint96 minWithdrawAmount_,
        uint96 withdrawFee_
    ) public initializer validAddress(owner_) validAddress(systemWithdrawAddress_) {
        // minWithdrawAmount must cover the withdrawFee at all times
        if (minWithdrawAmount_ < withdrawFee_) {
            revert AvoDepositManager__InvalidParams();
        }

        _transferOwnership(owner_);

        // contract will be paused at start, must be manually unpaused
        _pause();

        systemWithdrawAddress = systemWithdrawAddress_;
        systemWithdrawLimit = systemWithdrawLimit_;
        minWithdrawAmount = minWithdrawAmount_;
        withdrawFee = withdrawFee_;
    }

    /***********************************|
    |            PUBLIC API             |
    |__________________________________*/

    /// @notice checks if a certain address `auth_` is an allowed auth
    function isAuth(address auth_) external view returns (bool) {
        return auths[auth_] == 1 || auth_ == owner();
    }

    /// @notice           Deposits `amount_` of deposit token to this contract and emits the `Deposit` event,
    ///                   with `receiver_` address used for off-chain tracking
    /// @param receiver_  address receiving funds via indirect off-chain tracking
    /// @param amount_    amount to deposit
    function depositOnBehalf(address receiver_, uint256 amount_) external validAddress(receiver_) {
        // @dev we can't use onlyAvocado modifier here because it would only work for an already deployed Avocado
        depositToken.safeTransferFrom(msg.sender, address(this), amount_);

        emit Deposit(msg.sender, receiver_, amount_);
    }

    /// @notice             removes a withdraw request, essentially denying it or retracting it.
    ///                     Only callable by auths or withdraw request receiver.
    /// @param withdrawId_  unique withdraw request id as created in `requestWithdraw()`
    function removeWithdrawRequest(bytes32 withdrawId_) external {
        WithdrawRequest memory withdrawRequest_ = withdrawRequests[withdrawId_];

        if (withdrawRequest_.amount == 0) {
            revert AvoDepositManager__RequestNotExist();
        }

        // only auths (& owner) or withdraw request receiver can remove a withdraw request
        // using inverted positive case to save gas
        if (!(auths[msg.sender] == 1 || msg.sender == owner() || msg.sender == withdrawRequest_.to)) {
            revert AvoDepositManager__Unauthorized();
        }

        delete withdrawRequests[withdrawId_];

        emit WithdrawRemoved(withdrawId_);
    }

    /// @notice         Requests withdrawal of `amount_`  of gas balance. Only callable by Avocado smart wallets.
    /// @param amount_  amount to withdraw
    /// @return         uniqueId_ the unique withdraw request id used to trigger processing
    function requestWithdraw(
        uint256 amount_
    ) external whenNotPaused onlyAvocado(msg.sender) returns (bytes32 uniqueId_) {
        uniqueId_ = _handleRequestWithdraw(amount_);
        emit WithdrawRequested(uniqueId_, msg.sender, amount_);
    }

    /// @notice         same as `requestWithdraw()` but anyone can request withdrawal of funds, not just
    ///                 Avocado smart wallets. Used for the Revenue sharing program.
    /// @param amount_  amount to withdraw
    /// @return         uniqueId_ the unique withdraw request id used to trigger processing
    function requestSourceWithdraw(uint256 amount_) external whenNotPaused returns (bytes32 uniqueId_) {
        uniqueId_ = _handleRequestWithdraw(amount_);
        emit SourceWithdrawRequested(uniqueId_, msg.sender, amount_);
    }

    /// @notice         same as `requestWithdraw()` but anyone can request withdrawal of funds, not just
    ///                 Avocado smart wallets. Used for the Referral sharing program.
    /// @param amount_  amount to withdraw
    /// @return         uniqueId_ the unique withdraw request id used to trigger processing
    function requestReferralWithdraw(uint256 amount_) external whenNotPaused returns (bytes32 uniqueId_) {
        uniqueId_ = _handleRequestWithdraw(amount_);
        emit ReferralWithdrawRequested(uniqueId_, msg.sender, amount_);
    }

    /// @notice override renounce ownership as it could leave the contract in an unwanted state if called by mistake.
    function renounceOwnership() public view override onlyOwner {
        revert AvoDepositManager__Unsupported();
    }
}
