// SPDX-License-Identifier: MIT
pragma solidity >=0.8.17;

contract MockErrorThrower {
    error CustomError3xUint256(uint256, uint256, uint256);
    error CustomErrorString(string);

    function throwCustomError3xUint256() public pure {
        revert CustomError3xUint256(1, 2, 3);
    }

    function throwCustomErrorString() public pure {
        revert CustomErrorString("throwCustomErrorString");
    }

    function throwCustomErrorStringTooLong() public pure {
        revert CustomErrorString(
            "throwCustomErrorStringVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryLong"
        );
    }

    function throwOutOfGas() public pure {
        while (true) {}
    }

    function throwRequire() public pure {
        // throws Error(string)
        require(false, "throwRequire");
    }

    function throwTooLongRequire() public pure {
        string
            memory errorString_ = "throwRequireVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryLong";
        require(bytes(errorString_).length > 250, "test string not long enough");
        // throws Error(string) with a length of > 250
        require(false, errorString_);
    }

    function throwPanic0x01() public pure {
        // throws Panic(uint256) with code 0x01
        assert(0 == 1);
    }

    function throwPanic0x12() public pure {
        // throws Panic(uint256) with code 0x12
        uint testZero = 0;
        assert(23 % testZero == 21);
    }

    function throwUnknown() public pure {
        revert();
    }
}
