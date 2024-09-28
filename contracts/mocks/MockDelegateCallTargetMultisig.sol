// SPDX-License-Identifier: MIT
pragma solidity >=0.8.18;

contract MockDelegateCallTargetMultisig {
    // same storage layout as AvocadoMultisigVariables.sol
    address internal _avoImpl;
    uint80 internal _avoNonce;
    uint8 internal _initialized;
    bool internal _initializing;
    // slot 1
    address internal _signersPointer; // _signersPointer for Multisig
    uint8 internal requiredSigners;
    uint8 internal signersCount;
    // slot 2
    mapping(bytes32 => uint256) internal _signedMessages;
    // slot 3
    mapping(bytes32 => uint256) public nonSequentialNonces;
    // slot 4 to 53
    uint256[50] private __gaps;
    // slot 54 transitory storage slot
    bytes31 internal _transientAllowHash;
    uint8 internal _transientId;

    // custom storage for mock contract after gap
    uint256[45] private __gap2;

    uint256 public callCount;

    bytes32 public constant TAMPERED_KEY = keccak256("TESTKEY");

    bytes31 internal constant RESET_BYTES31 = 0x00000000000000000000000000000000000000000000000000000000000001;

    event Called(address indexed sender, bytes data, uint256 indexed usedBalance, uint256 callCount);

    function emitCalled() external payable {
        callCount = callCount + 1;

        emit Called(msg.sender, msg.data, 0, callCount);
    }

    function tryModifyAvoImplementation() external {
        callCount = callCount + 1;

        _avoImpl = address(1);
        emit Called(msg.sender, msg.data, 0, callCount);
    }

    function tryModifyAvoNonce() external {
        callCount = callCount + 1;

        _avoNonce = 42375823785;
        emit Called(msg.sender, msg.data, 0, callCount);
    }

    function trySetInitializing() external {
        callCount = callCount + 1;

        _initializing = true;
        emit Called(msg.sender, msg.data, 0, callCount);
    }

    function trySetInitialized() external {
        callCount = callCount + 1;

        _initialized = 77;
        emit Called(msg.sender, msg.data, 0, callCount);
    }

    function trySetSignersPointer() external {
        callCount = callCount + 1;

        _signersPointer = address(1);
        emit Called(msg.sender, msg.data, 0, callCount);
    }

    function trySetRequiredSigners() external {
        callCount = callCount + 1;

        requiredSigners = 77;
        emit Called(msg.sender, msg.data, 0, callCount);
    }

    function trySetSignersCount() external {
        callCount = callCount + 1;

        signersCount = 77;
        emit Called(msg.sender, msg.data, 0, callCount);
    }

    function trySetSignedMessage() external {
        callCount = callCount + 1;

        _signedMessages[TAMPERED_KEY] = 77;
        emit Called(msg.sender, msg.data, 0, callCount);
    }

    function setTransientAllowHash() external {
        _transientAllowHash = bytes31(keccak256("some-test-value"));
    }

    function revertIfTransientAllowHashSet() external view {
        if (_transientAllowHash != RESET_BYTES31) {
            revert("transientAllowHash is set");
        }
    }

    function setTransientId() external {
        _transientId = 1;
    }

    function revertIfTransientIdSet() external view {
        if (_transientId != 0) {
            revert("transientId is set");
        }
    }

    function triggerRevert() external pure {
        revert("MOCK_REVERT");
    }

    function transferAmountTo(address to, uint256 amount) external payable {
        callCount = callCount + 1;

        payable(to).transfer(amount);

        emit Called(msg.sender, msg.data, amount, callCount);
    }
}
